import type { FastifyInstance } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { AnyColumn } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { expenses, serviceRecords, serviceTypes } from "../../db/schema.js";

const dailyReportQuerySchema = z.object({
  date: z.iso.date(),
});

const dateFilter = (column: AnyColumn, date: string) =>
  sql`(${column} AT TIME ZONE 'America/Sao_Paulo')::date = ${date}::date`;

export async function reportsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: unknown }>("/reports/daily", async (request, reply) => {
    const parsedQuery = dailyReportQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: "Informe uma data válida no formato YYYY-MM-DD.",
        details: parsedQuery.error.issues,
      });
    }

    const { date } = parsedQuery.data;
    const [serviceRows, expenseSummary, servicePaymentRows] = await Promise.all([
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
          quantity: sql<number>`count(${expenses.id})::int`,
          totalCents: sql<number>`coalesce(sum(${expenses.amountCents}), 0)::int`,
        })
        .from(expenses)
        .where(
          and(dateFilter(expenses.occurredAt, date), isNull(expenses.canceledAt)),
        ),
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
    const expensesCents = expenseSummary[0]?.totalCents ?? 0;

    return {
      date,
      services: serviceRows,
      paymentMethods: servicePaymentRows,
      serviceCount: serviceRows.reduce(
        (total, service) => total + service.quantity,
        0,
      ),
      grossRevenueCents,
      expenseCount: expenseSummary[0]?.quantity ?? 0,
      expensesCents,
      netRevenueCents: grossRevenueCents - expensesCents,
    };
  });
}
