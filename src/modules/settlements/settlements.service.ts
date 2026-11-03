import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  appUsers,
  dailySettlementItems,
  dailySettlements,
  serviceRecords,
} from "../../db/schema.js";

export function calculateRoleRevenueSplit(
  grossServicesCents: number,
  role: "admin" | "daily_operator" | null,
  tipsCents = 0,
) {
  if (role === "daily_operator") {
    const serviceOperatorShareCents = Math.floor(grossServicesCents / 2);
    return {
      operatorShareCents: serviceOperatorShareCents + tipsCents,
      adminShareCents: grossServicesCents - serviceOperatorShareCents,
    };
  }

  if (role === "admin") {
    return {
      operatorShareCents: 0,
      adminShareCents: grossServicesCents + tipsCents,
    };
  }

  return {
    operatorShareCents: 0,
    adminShareCents: 0,
  };
}

export type FlexibleOperatorExpenseItem = {
  userId: string;
  userName: string;
  serviceCount: number;
  grossServicesCents: number;
  tipsCents: number;
  expenseCents: number;
  adminShareCents: number;
};

export type FlexibleOperatorsExpense = {
  totalCents: number;
  grossServicesCents: number;
  tipsCents: number;
  adminShareCents: number;
  serviceCount: number;
  isFlexible: true;
  operators: FlexibleOperatorExpenseItem[];
};

type OperatorSettlement = {
  userId: string;
  userName: string;
  grossServicesCents: number;
  tipsCents: number;
  operatorShareCents: number;
  adminShareCents: number;
  serviceCount: number;
};

export type DailySettlementCalculation = {
  adminOwnServicesCents: number;
  adminTipsCents: number;
  dailyOperatorsShareCents: number;
  dailyOperatorsTipsCents: number;
  adminDailyOperatorsShareCents: number;
  adminTotalDueCents: number;
  dailyOperatorsTotalDueCents: number;
  grossServicesCents: number;
  tipsCents: number;
  unidentifiedServicesCents: number;
  unidentifiedTipsCents: number;
  unidentifiedServiceCount: number;
  dailyOperators: OperatorSettlement[];
};

export type PeriodicSettlement = {
  periodStartDate: string;
  periodEndDate: string;
  calculationMode: "daily_snapshots_and_open_days";
  adminOwnServicesCents: number;
  adminTipsCents: number;
  dailyOperatorsGrossServicesCents: number;
  dailyOperatorsTipsCents: number;
  tipsCents: number;
  dailyOperatorsShareCents: number;
  adminDailyOperatorsShareCents: number;
  adminTotalDueCents: number;
  dailyOperatorsTotalDueCents: number;
  unidentifiedServicesCents: number;
  unidentifiedTipsCents: number;
  unidentifiedServiceCount: number;
  dailyOperators: OperatorSettlement[];
  days: Array<{
    date: string;
    status: "closed" | "open";
    adminTotalDueCents: number;
    dailyOperatorsTotalDueCents: number;
  }>;
  closedDaysCount: number;
  openDaysCount: number;
};

export async function calculateDailySettlement(
  date: string,
): Promise<DailySettlementCalculation> {
  const rows = await db
    .select({
      userId: appUsers.id,
      userName: appUsers.name,
      role: appUsers.role,
      serviceCount: sql<number>`count(${serviceRecords.id})::int`,
      grossServicesCents: sql<number>`coalesce(sum(${serviceRecords.priceCents}), 0)::int`,
      tipsCents: sql<number>`coalesce(sum(${serviceRecords.tipCents}), 0)::int`,
    })
    .from(serviceRecords)
    .leftJoin(appUsers, eq(serviceRecords.createdBy, appUsers.id))
    .where(
      and(
        sql`(${serviceRecords.occurredAt} AT TIME ZONE 'America/Sao_Paulo')::date = ${date}::date`,
        isNull(serviceRecords.canceledAt),
      ),
    )
    .groupBy(appUsers.id, appUsers.name, appUsers.role);

  let adminOwnServicesCents = 0;
  let adminTipsCents = 0;
  let grossServicesCents = 0;
  let tipsCents = 0;
  let unidentifiedServicesCents = 0;
  let unidentifiedTipsCents = 0;
  let unidentifiedServiceCount = 0;
  const dailyOperators: OperatorSettlement[] = [];

  for (const row of rows) {
    const gross = row.grossServicesCents;
    const tips = row.tipsCents;
    grossServicesCents += gross;
    tipsCents += tips;

    if (row.role === "admin") {
      adminOwnServicesCents += gross;
      adminTipsCents += tips;
      continue;
    }

    if (row.role === "daily_operator" && row.userId && row.userName) {
      const split = calculateRoleRevenueSplit(gross, "daily_operator", tips);
      dailyOperators.push({
        userId: row.userId,
        userName: row.userName,
        grossServicesCents: gross,
        tipsCents: tips,
        operatorShareCents: split.operatorShareCents,
        adminShareCents: split.adminShareCents,
        serviceCount: row.serviceCount,
      });
      continue;
    }

    unidentifiedServicesCents += gross;
    unidentifiedTipsCents += tips;
    unidentifiedServiceCount += row.serviceCount;
  }

  const dailyOperatorsShareCents = dailyOperators.reduce(
    (total, operator) => total + operator.operatorShareCents,
    0,
  );
  const dailyOperatorsTipsCents = dailyOperators.reduce(
    (total, operator) => total + operator.tipsCents,
    0,
  );
  const adminDailyOperatorsShareCents = dailyOperators.reduce(
    (total, operator) => total + operator.adminShareCents,
    0,
  );

  return {
    adminOwnServicesCents,
    adminTipsCents,
    dailyOperatorsShareCents,
    dailyOperatorsTipsCents,
    adminDailyOperatorsShareCents,
    adminTotalDueCents:
      adminOwnServicesCents + adminTipsCents + adminDailyOperatorsShareCents,
    dailyOperatorsTotalDueCents: dailyOperatorsShareCents,
    grossServicesCents,
    tipsCents,
    unidentifiedServicesCents,
    unidentifiedTipsCents,
    unidentifiedServiceCount,
    dailyOperators,
  };
}

export async function getDailySettlement(date: string) {
  const [settlement] = await db
    .select()
    .from(dailySettlements)
    .where(eq(dailySettlements.settlementDate, date))
    .limit(1);

  if (!settlement) {
    return null;
  }

  const items = await db
    .select({
      userId: dailySettlementItems.userId,
      userName: appUsers.name,
      grossServicesCents: dailySettlementItems.grossServicesCents,
      tipsCents: dailySettlementItems.tipsCents,
      operatorShareCents: dailySettlementItems.operatorShareCents,
      adminShareCents: dailySettlementItems.adminShareCents,
      serviceCount: dailySettlementItems.serviceCount,
    })
    .from(dailySettlementItems)
    .innerJoin(appUsers, eq(dailySettlementItems.userId, appUsers.id))
    .where(eq(dailySettlementItems.settlementId, settlement.id))
    .orderBy(appUsers.name);
  const [closedByUser] = settlement.closedBy
    ? await db
        .select({ userId: appUsers.id, userName: appUsers.name })
        .from(appUsers)
        .where(eq(appUsers.id, settlement.closedBy))
        .limit(1)
    : [];

  return {
    settlementId: settlement.id,
    date: settlement.settlementDate,
    status: settlement.status,
    closedAt: settlement.closedAt,
    admin: {
      ownServicesCents: settlement.adminOwnServicesCents,
      tipsCents: settlement.adminTipsCents,
      dailyOperatorsShareCents: settlement.adminDailyOperatorsShareCents,
      totalDueCents: settlement.adminTotalDueCents,
    },
    dailyOperators: items,
    grossServicesCents: settlement.grossServicesCents,
    tipsCents: settlement.tipsCents,
    dailyOperatorsTipsCents: settlement.dailyOperatorsTipsCents,
    dailyOperatorsTotalDueCents: settlement.dailyOperatorsTotalDueCents,
    closedBy: closedByUser ?? null,
    unidentifiedServicesCents: settlement.unidentifiedServicesCents,
    unidentifiedTipsCents: settlement.unidentifiedTipsCents,
    unidentifiedServiceCount: settlement.unidentifiedServiceCount,
  };
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function calculateLiveOperatorsExpense(
  startDate: string,
  endDate: string,
): Promise<FlexibleOperatorsExpense> {
  const rows = await db
    .select({
      serviceDate: sql<string>`(${serviceRecords.occurredAt} AT TIME ZONE 'America/Sao_Paulo')::date::text`,
      userId: appUsers.id,
      userName: appUsers.name,
      serviceCount: sql<number>`count(${serviceRecords.id})::int`,
      grossServicesCents: sql<number>`coalesce(sum(${serviceRecords.priceCents}), 0)::int`,
      tipsCents: sql<number>`coalesce(sum(${serviceRecords.tipCents}), 0)::int`,
    })
    .from(serviceRecords)
    .innerJoin(appUsers, eq(serviceRecords.createdBy, appUsers.id))
    .where(
      and(
        sql`(${serviceRecords.occurredAt} AT TIME ZONE 'America/Sao_Paulo') >= ${startDate}::date`,
        sql`(${serviceRecords.occurredAt} AT TIME ZONE 'America/Sao_Paulo') < ${endDate}::date`,
        isNull(serviceRecords.canceledAt),
        eq(appUsers.role, "daily_operator"),
      ),
    )
    .groupBy(
      sql`(${serviceRecords.occurredAt} AT TIME ZONE 'America/Sao_Paulo')::date`,
      appUsers.id,
      appUsers.name,
    );

  const byOperator = new Map<string, FlexibleOperatorExpenseItem>();

  for (const row of rows) {
    const split = calculateRoleRevenueSplit(
      row.grossServicesCents,
      "daily_operator",
      row.tipsCents,
    );
    const current = byOperator.get(row.userId) ?? {
      userId: row.userId,
      userName: row.userName,
      serviceCount: 0,
      grossServicesCents: 0,
      tipsCents: 0,
      expenseCents: 0,
      adminShareCents: 0,
    };

    current.serviceCount += row.serviceCount;
    current.grossServicesCents += row.grossServicesCents;
    current.tipsCents += row.tipsCents;
    current.expenseCents += split.operatorShareCents;
    current.adminShareCents += split.adminShareCents;
    byOperator.set(row.userId, current);
  }

  const operators = [...byOperator.values()].sort((a, b) =>
    a.userName.localeCompare(b.userName, "pt-BR"),
  );

  return {
    totalCents: operators.reduce((sum, op) => sum + op.expenseCents, 0),
    grossServicesCents: operators.reduce(
      (sum, op) => sum + op.grossServicesCents,
      0,
    ),
    tipsCents: operators.reduce((sum, op) => sum + op.tipsCents, 0),
    adminShareCents: operators.reduce((sum, op) => sum + op.adminShareCents, 0),
    serviceCount: operators.reduce((sum, op) => sum + op.serviceCount, 0),
    isFlexible: true,
    operators,
  };
}

export async function calculatePeriodicSettlement(
  startDate: string,
  endDate: string,
): Promise<PeriodicSettlement> {
  const [snapshots, liveRows] = await Promise.all([
    db
      .select()
      .from(dailySettlements)
      .where(
        and(
          sql`${dailySettlements.settlementDate} >= ${startDate}::date`,
          sql`${dailySettlements.settlementDate} < ${endDate}::date`,
        ),
      ),
    db
      .select({
        serviceDate: sql<string>`(${serviceRecords.occurredAt} AT TIME ZONE 'America/Sao_Paulo')::date::text`,
        userId: appUsers.id,
        userName: appUsers.name,
        role: appUsers.role,
        serviceCount: sql<number>`count(${serviceRecords.id})::int`,
        grossServicesCents: sql<number>`coalesce(sum(${serviceRecords.priceCents}), 0)::int`,
        tipsCents: sql<number>`coalesce(sum(${serviceRecords.tipCents}), 0)::int`,
      })
      .from(serviceRecords)
      .leftJoin(appUsers, eq(serviceRecords.createdBy, appUsers.id))
      .where(
        and(
          sql`(${serviceRecords.occurredAt} AT TIME ZONE 'America/Sao_Paulo') >= ${startDate}::date`,
          sql`(${serviceRecords.occurredAt} AT TIME ZONE 'America/Sao_Paulo') < ${endDate}::date`,
          isNull(serviceRecords.canceledAt),
        ),
      )
      .groupBy(
        sql`(${serviceRecords.occurredAt} AT TIME ZONE 'America/Sao_Paulo')::date`,
        appUsers.id,
        appUsers.name,
        appUsers.role,
      ),
  ]);

  const snapshotIds = snapshots.map((snapshot) => snapshot.id);
  const allSnapshotItems =
    snapshotIds.length > 0
      ? await db
          .select({
            settlementId: dailySettlementItems.settlementId,
            userId: dailySettlementItems.userId,
            userName: appUsers.name,
            grossServicesCents: dailySettlementItems.grossServicesCents,
            tipsCents: dailySettlementItems.tipsCents,
            operatorShareCents: dailySettlementItems.operatorShareCents,
            adminShareCents: dailySettlementItems.adminShareCents,
            serviceCount: dailySettlementItems.serviceCount,
          })
          .from(dailySettlementItems)
          .innerJoin(appUsers, eq(dailySettlementItems.userId, appUsers.id))
          .where(inArray(dailySettlementItems.settlementId, snapshotIds))
      : [];

  const itemsBySettlementId = new Map<string, typeof allSnapshotItems>();
  for (const item of allSnapshotItems) {
    const list = itemsBySettlementId.get(item.settlementId) ?? [];
    list.push(item);
    itemsBySettlementId.set(item.settlementId, list);
  }

  const liveRowsByDate = new Map<string, typeof liveRows>();
  for (const row of liveRows) {
    const list = liveRowsByDate.get(row.serviceDate) ?? [];
    list.push(row);
    liveRowsByDate.set(row.serviceDate, list);
  }

  const snapshotByDate = new Map(
    snapshots.map((snapshot) => [snapshot.settlementDate, snapshot]),
  );
  const aggregate = new Map<string, OperatorSettlement>();
  const periodDays: PeriodicSettlement["days"] = [];
  let adminOwnServicesCents = 0;
  let adminTipsCents = 0;
  let dailyOperatorsGrossServicesCents = 0;
  let dailyOperatorsTipsCents = 0;
  let tipsCents = 0;
  let dailyOperatorsShareCents = 0;
  let adminDailyOperatorsShareCents = 0;
  let unidentifiedServicesCents = 0;
  let unidentifiedTipsCents = 0;
  let unidentifiedServiceCount = 0;
  let closedDaysCount = 0;
  let openDaysCount = 0;

  let date = startDate;
  while (date < endDate) {
    const snapshot = snapshotByDate.get(date);

    if (snapshot) {
      closedDaysCount += 1;
      adminOwnServicesCents += snapshot.adminOwnServicesCents;
      adminTipsCents += snapshot.adminTipsCents;
      dailyOperatorsTipsCents += snapshot.dailyOperatorsTipsCents;
      tipsCents += snapshot.tipsCents;
      dailyOperatorsShareCents += snapshot.dailyOperatorsTotalDueCents;
      adminDailyOperatorsShareCents +=
        snapshot.adminDailyOperatorsShareCents;
      unidentifiedServicesCents += snapshot.unidentifiedServicesCents;
      unidentifiedTipsCents += snapshot.unidentifiedTipsCents;
      unidentifiedServiceCount += snapshot.unidentifiedServiceCount;
      periodDays.push({
        date,
        status: "closed",
        adminTotalDueCents: snapshot.adminTotalDueCents,
        dailyOperatorsTotalDueCents: snapshot.dailyOperatorsTotalDueCents,
      });

      const items = itemsBySettlementId.get(snapshot.id) ?? [];
      for (const item of items) {
        const current = aggregate.get(item.userId) ?? {
          userId: item.userId,
          userName: item.userName,
          grossServicesCents: 0,
          tipsCents: 0,
          operatorShareCents: 0,
          adminShareCents: 0,
          serviceCount: 0,
        };
        current.grossServicesCents += item.grossServicesCents;
        current.tipsCents += item.tipsCents;
        current.operatorShareCents += item.operatorShareCents;
        current.adminShareCents += item.adminShareCents;
        current.serviceCount += item.serviceCount;
        aggregate.set(item.userId, current);
      }
    } else {
      openDaysCount += 1;
      const dayRows = liveRowsByDate.get(date) ?? [];
      let dayAdminOwnCents = 0;
      let dayAdminTipsCents = 0;
      let dayOperatorsTipsCents = 0;
      let dayTipsCents = 0;
      let dayOperatorsShareCents = 0;
      let dayAdminOperatorsShareCents = 0;
      let dayUnidentifiedCents = 0;
      let dayUnidentifiedTipsCents = 0;
      let dayUnidentifiedCount = 0;

      for (const row of dayRows) {
        const gross = row.grossServicesCents;
        const tips = row.tipsCents;
        dayTipsCents += tips;

        if (row.role === "admin") {
          dayAdminOwnCents += gross;
          dayAdminTipsCents += tips;
          continue;
        }
        if (row.role === "daily_operator" && row.userId && row.userName) {
          const split = calculateRoleRevenueSplit(gross, "daily_operator", tips);
          dayOperatorsShareCents += split.operatorShareCents;
          dayOperatorsTipsCents += tips;
          dayAdminOperatorsShareCents += split.adminShareCents;

          const current = aggregate.get(row.userId) ?? {
            userId: row.userId,
            userName: row.userName,
            grossServicesCents: 0,
            tipsCents: 0,
            operatorShareCents: 0,
            adminShareCents: 0,
            serviceCount: 0,
          };
          current.grossServicesCents += gross;
          current.tipsCents += tips;
          current.operatorShareCents += split.operatorShareCents;
          current.adminShareCents += split.adminShareCents;
          current.serviceCount += row.serviceCount;
          current.userName = row.userName;
          aggregate.set(row.userId, current);
          continue;
        }

        dayUnidentifiedCents += gross;
        dayUnidentifiedTipsCents += tips;
        dayUnidentifiedCount += row.serviceCount;
      }

      adminOwnServicesCents += dayAdminOwnCents;
      adminTipsCents += dayAdminTipsCents;
      dailyOperatorsTipsCents += dayOperatorsTipsCents;
      tipsCents += dayTipsCents;
      dailyOperatorsShareCents += dayOperatorsShareCents;
      adminDailyOperatorsShareCents += dayAdminOperatorsShareCents;
      unidentifiedServicesCents += dayUnidentifiedCents;
      unidentifiedTipsCents += dayUnidentifiedTipsCents;
      unidentifiedServiceCount += dayUnidentifiedCount;
      periodDays.push({
        date,
        status: "open",
        adminTotalDueCents:
          dayAdminOwnCents + dayAdminTipsCents + dayAdminOperatorsShareCents,
        dailyOperatorsTotalDueCents: dayOperatorsShareCents,
      });
    }

    date = addDays(date, 1);
  }

  const dailyOperators = [...aggregate.values()].filter(
    (item) => item.serviceCount > 0,
  );
  dailyOperatorsGrossServicesCents = dailyOperators.reduce(
    (total, item) => total + item.grossServicesCents,
    0,
  );

  return {
    periodStartDate: startDate,
    periodEndDate: endDate,
    calculationMode: "daily_snapshots_and_open_days",
    adminOwnServicesCents,
    adminTipsCents,
    dailyOperatorsGrossServicesCents,
    dailyOperatorsTipsCents,
    tipsCents,
    dailyOperatorsShareCents,
    adminDailyOperatorsShareCents,
    adminTotalDueCents:
      adminOwnServicesCents + adminTipsCents + adminDailyOperatorsShareCents,
    dailyOperatorsTotalDueCents: dailyOperatorsShareCents,
    unidentifiedServicesCents,
    unidentifiedTipsCents,
    unidentifiedServiceCount,
    dailyOperators,
    days: periodDays,
    closedDaysCount,
    openDaysCount,
  };
}
