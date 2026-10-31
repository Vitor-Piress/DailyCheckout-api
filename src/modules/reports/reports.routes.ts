import type { FastifyInstance } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { expenses, serviceRecords, serviceTypes } from "../../db/schema.js";

const dailyReportQuerySchema = z.object({
  date: z.iso.date(),
});

const periodicReportQuerySchema = z.object({
  period: z.enum(["month", "quarter", "semester", "year"]),
  date: z.iso.date(),
});

const dateFilter = (column: AnyColumn, date: string) =>
  sql`(${column} AT TIME ZONE 'America/Sao_Paulo')::date = ${date}::date`;

const periodFilter = (column: AnyColumn, startDate: string, endDate: string) =>
  sql`(${column} AT TIME ZONE 'America/Sao_Paulo') >= ${startDate}::date
    and (${column} AT TIME ZONE 'America/Sao_Paulo') < ${endDate}::date`;

function getPeriodBounds(period: z.infer<typeof periodicReportQuerySchema>["period"], date: string) {
  const [year, month] = date.split("-").map(Number);
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
    const [serviceRows, servicePaymentRows] = await Promise.all([
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
          ),
        )
        .groupBy(serviceRecords.paymentMethod)
        .orderBy(serviceRecords.paymentMethod),
    ]);

    const grossRevenueCents = serviceRows.reduce(
      (total, service) => total + service.totalCents,
      0,
    );
    return {
      date,
      services: serviceRows,
      paymentMethods: servicePaymentRows,
      serviceCount: serviceRows.reduce(
        (total, service) => total + service.quantity,
        0,
      ),
      grossRevenueCents,
    };
  });

  app.get<{ Querystring: unknown }>(
    "/reports/periodic",
    {
      schema: {
        tags: ["reports"],
        summary: "Gera relatório financeiro mensal, trimestral, semestral ou anual",
        querystring: {
          type: "object",
          required: ["period", "date"],
          properties: {
            period: {
              type: "string",
              enum: ["month", "quarter", "semester", "year"],
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
        const [serviceSummary, expenseSummary, paymentSummary] =
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
        };
    },
  );
}
