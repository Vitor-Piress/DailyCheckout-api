import type { FastifyInstance } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { appUsers, expenses, serviceRecords, serviceTypes } from "../../db/schema.js";
import { calculateDailySettlement } from "../settlements/settlements.service.js";

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
      services: Array<{
        serviceTypeId: string;
        serviceName: string;
        quantity: number;
        totalCents: number;
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
      services: [],
    };

    summary.serviceCount += row.quantity;
    summary.grossRevenueCents += row.totalCents;
    summary.services.push({
      serviceTypeId: row.serviceTypeId,
      serviceName: row.serviceName,
      quantity: row.quantity,
      totalCents: row.totalCents,
    });
    summaries.set(key, summary);
  }

  return [...summaries.values()];
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

    const grossRevenueCents = serviceRows.reduce(
      (total, service) => total + service.totalCents,
      0,
    );
    const settlement =
      request.currentUser.role === "admin"
        ? {
            ...await calculateDailySettlement(date),
            settlementStatus: "open" as const,
          }
        : null;

    return {
      date,
      services: serviceRows,
      paymentMethods: servicePaymentRows,
      serviceCount: serviceRows.reduce(
        (total, service) => total + service.quantity,
        0,
      ),
      grossRevenueCents,
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
        const [serviceSummary, expenseSummary, paymentSummary, userServiceRows] =
          await Promise.all([
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
                  periodFilter(expenses.occurredAt, startDate, endDate),
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
                  periodFilter(expenses.occurredAt, startDate, endDate),
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
          ]);

        const grossRevenueCents = serviceSummary[0]?.totalCents ?? 0;
        const expensesCents = expenseSummary[0]?.totalCents ?? 0;

        return {
          period,
          startDate,
          endDate,
          serviceCount: serviceSummary[0]?.quantity ?? 0,
          grossRevenueCents,
          expenseCount: expenseSummary[0]?.quantity ?? 0,
          expensesCents,
          netRevenueCents: grossRevenueCents - expensesCents,
          expensesByPaymentMethod: paymentSummary,
          users: buildUserSummaries(userServiceRows),
        };
    },
  );
}
