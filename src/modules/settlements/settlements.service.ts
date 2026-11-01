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
  dailyOperators: OperatorSettlement[];
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
    }
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

  return {
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
  };
}
