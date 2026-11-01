import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import {
  appUsers,
  dailySettlementItems,
  dailySettlements,
  serviceRecords,
} from "../../db/schema.js";

type OperatorSettlement = {
  userId: string;
  userName: string;
  grossServicesCents: number;
  operatorShareCents: number;
  adminShareCents: number;
  serviceCount: number;
};

export type DailySettlementCalculation = {
  adminOwnServicesCents: number;
  dailyOperatorsShareCents: number;
  adminDailyOperatorsShareCents: number;
  adminTotalDueCents: number;
  dailyOperatorsTotalDueCents: number;
  grossServicesCents: number;
  unidentifiedServicesCents: number;
  unidentifiedServiceCount: number;
  dailyOperators: OperatorSettlement[];
};

export type PeriodicSettlement = {
  periodStartDate: string;
  periodEndDate: string;
  calculationMode: "daily_snapshots_and_open_days";
  adminOwnServicesCents: number;
  dailyOperatorsGrossServicesCents: number;
  dailyOperatorsShareCents: number;
  adminDailyOperatorsShareCents: number;
  adminTotalDueCents: number;
  dailyOperatorsTotalDueCents: number;
  unidentifiedServicesCents: number;
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
  let grossServicesCents = 0;
  let unidentifiedServicesCents = 0;
  let unidentifiedServiceCount = 0;
  const dailyOperators: OperatorSettlement[] = [];

  for (const row of rows) {
    const gross = row.grossServicesCents;
    grossServicesCents += gross;

    if (row.role === "admin") {
      adminOwnServicesCents += gross;
      continue;
    }

    if (row.role === "daily_operator" && row.userId && row.userName) {
      const operatorShareCents = Math.floor(gross / 2);
      dailyOperators.push({
        userId: row.userId,
        userName: row.userName,
        grossServicesCents: gross,
        operatorShareCents,
        adminShareCents: gross - operatorShareCents,
        serviceCount: row.serviceCount,
      });
      continue;
    }

    unidentifiedServicesCents += gross;
    unidentifiedServiceCount += row.serviceCount;
  }

  const dailyOperatorsShareCents = dailyOperators.reduce(
    (total, operator) => total + operator.operatorShareCents,
    0,
  );
  const adminDailyOperatorsShareCents = dailyOperators.reduce(
    (total, operator) => total + operator.adminShareCents,
    0,
  );

  return {
    adminOwnServicesCents,
    dailyOperatorsShareCents,
    adminDailyOperatorsShareCents,
    adminTotalDueCents:
      adminOwnServicesCents + adminDailyOperatorsShareCents,
    dailyOperatorsTotalDueCents: dailyOperatorsShareCents,
    grossServicesCents,
    unidentifiedServicesCents,
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
      dailyOperatorsShareCents: settlement.adminDailyOperatorsShareCents,
      totalDueCents: settlement.adminTotalDueCents,
    },
    dailyOperators: items,
    grossServicesCents: settlement.grossServicesCents,
    dailyOperatorsTotalDueCents: settlement.dailyOperatorsTotalDueCents,
    closedBy: closedByUser ?? null,
    unidentifiedServicesCents: settlement.unidentifiedServicesCents,
    unidentifiedServiceCount: settlement.unidentifiedServiceCount,
  };
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export async function calculatePeriodicSettlement(
  startDate: string,
  endDate: string,
): Promise<PeriodicSettlement> {
  const snapshots = await db
    .select()
    .from(dailySettlements)
    .where(
      and(
        sql`${dailySettlements.settlementDate} >= ${startDate}::date`,
        sql`${dailySettlements.settlementDate} < ${endDate}::date`,
      ),
    );

  const snapshotByDate = new Map(
    snapshots.map((snapshot) => [snapshot.settlementDate, snapshot]),
  );
  const aggregate = new Map<string, OperatorSettlement>();
  const periodDays: PeriodicSettlement["days"] = [];
  let adminOwnServicesCents = 0;
  let dailyOperatorsGrossServicesCents = 0;
  let dailyOperatorsShareCents = 0;
  let adminDailyOperatorsShareCents = 0;
  let unidentifiedServicesCents = 0;
  let unidentifiedServiceCount = 0;
  let closedDaysCount = 0;
  let openDaysCount = 0;

  let date = startDate;
  while (date < endDate) {
    const snapshot = snapshotByDate.get(date);
    const calculation = snapshot
      ? null
      : await calculateDailySettlement(date);

    if (snapshot) {
      closedDaysCount += 1;
      adminOwnServicesCents += snapshot.adminOwnServicesCents;
      dailyOperatorsShareCents += snapshot.dailyOperatorsTotalDueCents;
      adminDailyOperatorsShareCents +=
        snapshot.adminDailyOperatorsShareCents;
      unidentifiedServicesCents += snapshot.unidentifiedServicesCents;
      unidentifiedServiceCount += snapshot.unidentifiedServiceCount;
      periodDays.push({
        date,
        status: "closed",
        adminTotalDueCents: snapshot.adminTotalDueCents,
        dailyOperatorsTotalDueCents: snapshot.dailyOperatorsTotalDueCents,
      });

      const items = await db
        .select({
          userId: dailySettlementItems.userId,
          userName: appUsers.name,
          grossServicesCents: dailySettlementItems.grossServicesCents,
          operatorShareCents: dailySettlementItems.operatorShareCents,
          adminShareCents: dailySettlementItems.adminShareCents,
          serviceCount: dailySettlementItems.serviceCount,
        })
        .from(dailySettlementItems)
        .innerJoin(appUsers, eq(dailySettlementItems.userId, appUsers.id))
        .where(eq(dailySettlementItems.settlementId, snapshot.id));
      for (const item of items) {
        const current = aggregate.get(item.userId) ?? {
          userId: item.userId,
          userName: item.userName,
          grossServicesCents: 0,
          operatorShareCents: 0,
          adminShareCents: 0,
          serviceCount: 0,
        };
        current.grossServicesCents += item.grossServicesCents;
        current.operatorShareCents += item.operatorShareCents;
        current.adminShareCents += item.adminShareCents;
        current.serviceCount += item.serviceCount;
        aggregate.set(item.userId, current);
      }
    } else {
      openDaysCount += 1;
      adminOwnServicesCents += calculation!.adminOwnServicesCents;
      dailyOperatorsGrossServicesCents += calculation!.dailyOperators
        .reduce((total, item) => total + item.grossServicesCents, 0);
      dailyOperatorsShareCents += calculation!.dailyOperatorsShareCents;
      adminDailyOperatorsShareCents +=
        calculation!.adminDailyOperatorsShareCents;
      unidentifiedServicesCents += calculation!.unidentifiedServicesCents;
      unidentifiedServiceCount += calculation!.unidentifiedServiceCount;
      periodDays.push({
        date,
        status: "open",
        adminTotalDueCents: calculation!.adminTotalDueCents,
        dailyOperatorsTotalDueCents: calculation!.dailyOperatorsTotalDueCents,
      });
      for (const item of calculation!.dailyOperators) {
        const current = aggregate.get(item.userId) ?? {
          ...item,
          grossServicesCents: 0,
          operatorShareCents: 0,
          adminShareCents: 0,
          serviceCount: 0,
        };
        current.grossServicesCents += item.grossServicesCents;
        current.operatorShareCents += item.operatorShareCents;
        current.adminShareCents += item.adminShareCents;
        current.serviceCount += item.serviceCount;
        current.userName = item.userName;
        aggregate.set(item.userId, current);
      }
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
    dailyOperatorsGrossServicesCents,
    dailyOperatorsShareCents,
    adminDailyOperatorsShareCents,
    adminTotalDueCents:
      adminOwnServicesCents + adminDailyOperatorsShareCents,
    dailyOperatorsTotalDueCents: dailyOperatorsShareCents,
    unidentifiedServicesCents,
    unidentifiedServiceCount,
    dailyOperators,
    days: periodDays,
    closedDaysCount,
    openDaysCount,
  };
}
