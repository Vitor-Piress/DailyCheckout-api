import type { FastifyInstance } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { appUsers, expenses, serviceRecords, serviceTypes } from "../../db/schema.js";
import {
  calculateDailySettlement,
  calculateLiveOperatorsExpense,
  calculatePeriodicSettlement,
  calculateRoleRevenueSplit,
  getDailySettlement,
} from "../settlements/settlements.service.js";

type UserServiceSummaryRow = {
  userId: string | null;
  userName: string | null;
  role: "admin" | "daily_operator" | null;
  serviceTypeId: string;
  serviceName: string;
  quantity: number;
  totalCents: number;
};

function buildUserSummaries(rows: UserServiceSummaryRow[]) {
  const summaries = new Map<
    string,
    {
      userId: string | null;
      userName: string;
      role: "admin" | "daily_operator" | null;
      serviceCount: number;
      grossRevenueCents: number;
      operatorShareCents: number;
      adminShareCents: number;
      services: Array<{
        serviceTypeId: string;
        serviceName: string;
        quantity: number;
        totalCents: number;
        operatorShareCents: number;
        adminShareCents: number;
      }>;
    }
  >();

  for (const row of rows) {
    const key = row.userId ?? "unknown";
    const summary = summaries.get(key) ?? {
      userId: row.userId,
      userName: row.userName ?? "Autor não identificado",
      role: row.role,
      serviceCount: 0,
      grossRevenueCents: 0,
      operatorShareCents: 0,
      adminShareCents: 0,
      services: [],
    };

    const serviceSplit = calculateRoleRevenueSplit(row.totalCents, row.role);
    summary.serviceCount += row.quantity;
    summary.grossRevenueCents += row.totalCents;
    summary.services.push({
      serviceTypeId: row.serviceTypeId,
      serviceName: row.serviceName,
      quantity: row.quantity,
      totalCents: row.totalCents,
      operatorShareCents: serviceSplit.operatorShareCents,
      adminShareCents: serviceSplit.adminShareCents,
    });
    summaries.set(key, summary);
  }

  return [...summaries.values()].map((summary) => {
    const totalSplit = calculateRoleRevenueSplit(
      summary.grossRevenueCents,
      summary.role,
    );
    return {
      ...summary,
      operatorShareCents: totalSplit.operatorShareCents,
      adminShareCents: totalSplit.adminShareCents,
    };
  });
}

const dailyReportQuerySchema = z.object({
  date: z.iso.date(),
});

const periodicReportQuerySchema = z.object({
  period: z.enum(["week", "month", "quarter", "semester", "year"]),
  date: z.iso.date(),
});

const dateFilter = (column: AnyColumn, date: string) =>
  sql`(${column} AT TIME ZONE 'America/Sao_Paulo')::date = ${date}::date`;

const periodFilter = (column: AnyColumn, startDate: string, endDate: string) =>
  sql`(${column} AT TIME ZONE 'America/Sao_Paulo') >= ${startDate}::date
    and (${column} AT TIME ZONE 'America/Sao_Paulo') < ${endDate}::date`;

function getPeriodBounds(
  period: z.infer<typeof periodicReportQuerySchema>["period"],
  date: string,
) {
  const [year, month] = date.split("-").map(Number);

  if (period === "week") {
    const referenceDate = new Date(Date.UTC(year, month - 1, Number(date.slice(8, 10))));
    const dayOfWeek = referenceDate.getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const startDate = new Date(referenceDate);
    startDate.setUTCDate(referenceDate.getUTCDate() - daysSinceMonday);
    const endDate = new Date(startDate);
    endDate.setUTCDate(startDate.getUTCDate() + 7);
    const formatDate = (value: Date) => value.toISOString().slice(0, 10);

    return {
      startDate: formatDate(startDate),
      endDate: formatDate(endDate),
    };
  }

  const startMonth =
    period === "quarter"
      ? Math.floor((month - 1) / 3) * 3 + 1
      : period === "semester"
        ? month <= 6
          ? 1
          : 7
        : period === "year"
          ? 1
          : month;
  const endMonth =
    period === "quarter"
      ? startMonth + 3
      : period === "semester"
        ? startMonth + 6
        : period === "year"
          ? 13
          : startMonth + 1;
  const endYear = endMonth > 12 ? year + 1 : year;
  const normalizedEndMonth = endMonth > 12 ? endMonth - 12 : endMonth;

  return {
    startDate: `${year}-${String(startMonth).padStart(2, "0")}-01`,
    endDate: `${endYear}-${String(normalizedEndMonth).padStart(2, "0")}-01`,
  };
}

async function buildDailySettlementReport(date: string) {
  const [calculation, snapshot] = await Promise.all([
    calculateDailySettlement(date),
    getDailySettlement(date),
  ]);
  const calculatedAdminTotal = calculation.adminTotalDueCents;
  const calculatedOperatorsTotal = calculation.dailyOperatorsTotalDueCents;
  const closedSettlement = snapshot
    ? {
        settlementId: snapshot.settlementId,
        date: snapshot.date,
        status: snapshot.status,
        closedAt: snapshot.closedAt,
        closedBy: snapshot.closedBy,
        admin: snapshot.admin,
        dailyOperators: snapshot.dailyOperators,
        grossServicesCents: snapshot.grossServicesCents,
        dailyOperatorsTotalDueCents: snapshot.dailyOperatorsTotalDueCents,
        unidentifiedServicesCents: snapshot.unidentifiedServicesCents,
        unidentifiedServiceCount: snapshot.unidentifiedServiceCount,
      }
    : null;

  return {
    calculationStatus: snapshot ? "calculated" as const : "open" as const,
    persistenceStatus: snapshot ? "closed" as const : "not_closed" as const,
    admin: {
      ownServicesCents: calculation.adminOwnServicesCents,
      dailyOperatorsShareCents: calculation.adminDailyOperatorsShareCents,
      totalDueCents: calculatedAdminTotal,
    },
    dailyOperators: calculation.dailyOperators,
    grossServicesCents: calculation.grossServicesCents,
    dailyOperatorsTotalDueCents: calculatedOperatorsTotal,
    adminTotalDueCents: calculatedAdminTotal,
    unidentifiedServicesCents: calculation.unidentifiedServicesCents,
    unidentifiedServiceCount: calculation.unidentifiedServiceCount,
    closedSettlement,
    hasDifferenceFromCurrentCalculation: snapshot
      ? calculatedAdminTotal !== snapshot.admin.totalDueCents ||
        calculatedOperatorsTotal !== snapshot.dailyOperatorsTotalDueCents
      : false,
    differences: snapshot
      ? {
          adminTotalDueCents:
            calculatedAdminTotal - snapshot.admin.totalDueCents,
          dailyOperatorsTotalDueCents:
            calculatedOperatorsTotal -
            snapshot.dailyOperatorsTotalDueCents,
        }
      : null,
  };
}

export async function reportsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: unknown }>(
    "/reports/daily",
    {
      schema: {
        tags: ["reports"],
        summary: "Gera o relatório de atendimentos de um dia",
        querystring: {
          type: "object",
          required: ["date"],
          properties: { date: { type: "string", format: "date" } },
        },
        response: {
          200: { $ref: "DailyReport#" },
          400: { $ref: "ErrorResponse#" },
        },
      },
    },
    async (request, reply) => {
    const parsedQuery = dailyReportQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: "Informe uma data válida no formato YYYY-MM-DD.",
        details: parsedQuery.error.issues,
        },
      );
    }

    const { date } = parsedQuery.data;
    const authorFilter =
      request.currentUser.role === "admin"
        ? undefined
        : eq(serviceRecords.createdBy, request.currentUser.id);

    const [serviceRows, servicePaymentRows, userServiceRows] = await Promise.all([
      db
        .select({
          serviceTypeId: serviceTypes.id,
          serviceName: serviceTypes.name,
          quantity: sql<number>`count(${serviceRecords.id})::int`,
          totalCents: sql<number>`coalesce(sum(${serviceRecords.priceCents}), 0)::int`,
        })
        .from(serviceRecords)
        .innerJoin(serviceTypes, eq(serviceRecords.serviceTypeId, serviceTypes.id))
        .where(
          and(
            dateFilter(serviceRecords.occurredAt, date),
            isNull(serviceRecords.canceledAt),
            authorFilter,
          ),
        )
        .groupBy(serviceTypes.id, serviceTypes.name)
        .orderBy(sql`sum(${serviceRecords.priceCents}) desc`),
      db
        .select({
          paymentMethod: serviceRecords.paymentMethod,
          quantity: sql<number>`count(${serviceRecords.id})::int`,
          totalCents: sql<number>`coalesce(sum(${serviceRecords.priceCents}), 0)::int`,
        })
        .from(serviceRecords)
        .where(
          and(
            dateFilter(serviceRecords.occurredAt, date),
            isNull(serviceRecords.canceledAt),
            authorFilter,
          ),
        )
        .groupBy(serviceRecords.paymentMethod)
        .orderBy(serviceRecords.paymentMethod),
      db
        .select({
          userId: appUsers.id,
          userName: appUsers.name,
          role: appUsers.role,
          serviceTypeId: serviceTypes.id,
          serviceName: serviceTypes.name,
          quantity: sql<number>`count(${serviceRecords.id})::int`,
          totalCents: sql<number>`coalesce(sum(${serviceRecords.priceCents}), 0)::int`,
        })
        .from(serviceRecords)
        .innerJoin(serviceTypes, eq(serviceRecords.serviceTypeId, serviceTypes.id))
        .leftJoin(appUsers, eq(serviceRecords.createdBy, appUsers.id))
        .where(
          and(
            dateFilter(serviceRecords.occurredAt, date),
            isNull(serviceRecords.canceledAt),
            authorFilter,
          ),
        )
        .groupBy(
          appUsers.id,
          appUsers.name,
          appUsers.role,
          serviceTypes.id,
          serviceTypes.name,
        )
        .orderBy(appUsers.name, serviceTypes.name),
    ]);

    const serviceCount = serviceRows.reduce(
      (total, service) => total + service.quantity,
      0,
    );
    const grossRevenueCents = serviceRows.reduce(
      (total, service) => total + service.totalCents,
      0,
    );
    const settlement =
      request.currentUser.role === "admin"
        ? await buildDailySettlementReport(date)
        : null;
    const operatorShare =
      request.currentUser.role === "daily_operator"
        ? (() => {
            const split = calculateRoleRevenueSplit(
              grossRevenueCents,
              "daily_operator",
            );
            return {
              userId: request.currentUser.id,
              userName: request.currentUser.name,
              serviceCount,
              grossServicesCents: grossRevenueCents,
              operatorShareCents: split.operatorShareCents,
              adminShareCents: split.adminShareCents,
              sharePercentage: 50 as const,
            };
          })()
        : null;

    return {
      date,
      services: serviceRows,
      paymentMethods: servicePaymentRows,
      serviceCount,
      grossRevenueCents,
      operatorShare,
      users: buildUserSummaries(userServiceRows),
      settlement,
    };
  });

  app.get<{ Querystring: unknown }>(
    "/reports/periodic",
    {
      schema: {
        tags: ["reports"],
        summary: "Gera relatório financeiro semanal, mensal, trimestral, semestral ou anual",
        querystring: {
          type: "object",
          required: ["period", "date"],
          properties: {
            period: {
              type: "string",
              enum: ["week", "month", "quarter", "semester", "year"],
            },
            date: { type: "string", format: "date" },
          },
        },
        response: {
          200: { $ref: "PeriodicReport#" },
          400: { $ref: "ErrorResponse#" },
        },
      },
    },
    async (request, reply) => {
        const parsedQuery = periodicReportQuerySchema.safeParse(request.query);

        if (!parsedQuery.success) {
          return reply.code(400).send({
            error: "Informe period, date e uma data válida no formato YYYY-MM-DD.",
            details: parsedQuery.error.issues,
          });
        }

        const { period, date } = parsedQuery.data;
        const { startDate, endDate } = getPeriodBounds(period, date);
        const expenseDueDateFilter = sql`${expenses.dueDate} >= ${startDate}::date
          and ${expenses.dueDate} < ${endDate}::date`;
        const [
          serviceSummary,
          expenseSummary,
          paymentSummary,
          userServiceRows,
          dailyOperatorsExpense,
          settlement,
        ] = await Promise.all([
          db
            .select({
              quantity: sql<number>`count(${serviceRecords.id})::int`,
              totalCents: sql<number>`coalesce(sum(${serviceRecords.priceCents}), 0)::int`,
            })
            .from(serviceRecords)
            .where(
              and(
                periodFilter(serviceRecords.occurredAt, startDate, endDate),
                isNull(serviceRecords.canceledAt),
              ),
            ),
          db
            .select({
              quantity: sql<number>`count(${expenses.id})::int`,
              totalCents: sql<number>`coalesce(sum(${expenses.amountCents}), 0)::int`,
            })
            .from(expenses)
            .where(
              and(
                expenseDueDateFilter,
                isNull(expenses.canceledAt),
              ),
            ),
          db
            .select({
              paymentMethod: expenses.paymentMethod,
              quantity: sql<number>`count(${expenses.id})::int`,
              totalCents: sql<number>`coalesce(sum(${expenses.amountCents}), 0)::int`,
            })
            .from(expenses)
            .where(
              and(
                expenseDueDateFilter,
                isNull(expenses.canceledAt),
              ),
            )
            .groupBy(expenses.paymentMethod)
            .orderBy(expenses.paymentMethod),
          db
            .select({
              userId: appUsers.id,
              userName: appUsers.name,
              role: appUsers.role,
              serviceTypeId: serviceTypes.id,
              serviceName: serviceTypes.name,
              quantity: sql<number>`count(${serviceRecords.id})::int`,
              totalCents: sql<number>`coalesce(sum(${serviceRecords.priceCents}), 0)::int`,
            })
            .from(serviceRecords)
            .innerJoin(serviceTypes, eq(serviceRecords.serviceTypeId, serviceTypes.id))
            .leftJoin(appUsers, eq(serviceRecords.createdBy, appUsers.id))
            .where(
              and(
                periodFilter(serviceRecords.occurredAt, startDate, endDate),
                isNull(serviceRecords.canceledAt),
              ),
            )
            .groupBy(
              appUsers.id,
              appUsers.name,
              appUsers.role,
              serviceTypes.id,
              serviceTypes.name,
            )
            .orderBy(appUsers.name, serviceTypes.name),
          calculateLiveOperatorsExpense(startDate, endDate),
          request.currentUser.role === "admin"
            ? calculatePeriodicSettlement(startDate, endDate)
            : Promise.resolve(null),
        ]);

        const grossRevenueCents = serviceSummary[0]?.totalCents ?? 0;
        const expensesCents = expenseSummary[0]?.totalCents ?? 0;
        const dailyOperatorsExpenseCents = dailyOperatorsExpense.totalCents;
        const totalExpensesCents = expensesCents + dailyOperatorsExpenseCents;

        return {
          period,
          startDate,
          endDate,
          serviceCount: serviceSummary[0]?.quantity ?? 0,
          grossRevenueCents,
          expenseCount: expenseSummary[0]?.quantity ?? 0,
          expensesCents,
          dailyOperatorsExpenseCents,
          totalExpensesCents,
          netRevenueCents: grossRevenueCents - totalExpensesCents,
          expensesByPaymentMethod: paymentSummary,
          dailyOperatorsExpense,
          users: buildUserSummaries(userServiceRows),
          settlement,
        };
    },
  );
}
