import type { FastifyInstance } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { expenses } from "../../db/schema.js";

const paymentMethods = [
  "cash",
  "pix",
  "credit_card",
  "debit_card",
  "other",
] as const;

const createExpenseSchema = z.object({
  description: z.string().trim().min(1).max(200),
  amountCents: z.number().int().positive(),
  category: z.string().trim().min(1).max(100).optional(),
  paymentMethod: z.enum(paymentMethods),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  notes: z.string().trim().max(500).optional(),
});

const listExpensesQuerySchema = z.object({
  date: z.iso.date().optional(),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use o formato YYYY-MM.")
    .optional(),
}).refine(
  ({ date, month }) => (date !== undefined) !== (month !== undefined),
  "Informe exatamente um filtro: date ou month.",
);

export async function expensesRoutes(app: FastifyInstance) {
  app.get<{ Querystring: unknown }>(
    "/expenses",
    {
      schema: {
        tags: ["expenses"],
        summary: "Lista despesas por dia ou mês",
        querystring: {
          type: "object",
          properties: {
            date: { type: "string", format: "date" },
            month: { type: "string", pattern: "^\\d{4}-(0[1-9]|1[0-2])$" },
          },
        },
        response: {
          200: { type: "array", items: { $ref: "Expense#" } },
          400: { $ref: "ErrorResponse#" },
        },
      },
    },
    async (request, reply) => {
    const parsedQuery = listExpensesQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: "Informe exatamente um filtro válido: date=YYYY-MM-DD ou month=YYYY-MM.",
        details: parsedQuery.error.issues,
      });
    }

    const { date, month } = parsedQuery.data;
    const dateFilter = date
      ? sql`(${expenses.occurredAt} AT TIME ZONE 'America/Sao_Paulo')::date = ${date}::date`
      : (() => {
          const [year, monthNumber] = month!.split("-").map(Number);
          const nextMonth =
            monthNumber === 12
              ? `${year + 1}-01-01`
              : `${year}-${String(monthNumber + 1).padStart(2, "0")}-01`;

          return sql`(${expenses.occurredAt} AT TIME ZONE 'America/Sao_Paulo') >= ${`${month}-01`}::date
            and (${expenses.occurredAt} AT TIME ZONE 'America/Sao_Paulo') < ${nextMonth}::date`;
        })();

    return db
      .select({
        id: expenses.id,
        description: expenses.description,
        amountCents: expenses.amountCents,
        category: expenses.category,
        paymentMethod: expenses.paymentMethod,
        occurredAt: expenses.occurredAt,
        notes: expenses.notes,
        createdAt: expenses.createdAt,
      })
      .from(expenses)
      .where(
        and(
          dateFilter,
          isNull(expenses.canceledAt),
        ),
      )
      .orderBy(expenses.occurredAt);
    },
  );

  app.post<{ Body: unknown }>(
    "/expenses",
    {
      schema: {
        tags: ["expenses"],
        summary: "Registra uma despesa",
        body: { $ref: "CreateExpenseInput#" },
        response: {
          201: { $ref: "Expense#" },
          400: { $ref: "ErrorResponse#" },
        },
      },
    },
    async (request, reply) => {
    const parsedBody = createExpenseSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return reply.code(400).send({
        error: "Dados inválidos.",
        details: parsedBody.error.issues,
        },
      );
    }

    const { description, amountCents, category, paymentMethod, occurredAt, notes } =
      parsedBody.data;
    const [expense] = await db
      .insert(expenses)
      .values({
        description,
        amountCents,
        category: category || null,
        paymentMethod,
        occurredAt: occurredAt ? new Date(occurredAt) : undefined,
        createdBy: request.currentUser.id,
        notes: notes || null,
      })
      .returning({
        id: expenses.id,
        description: expenses.description,
        amountCents: expenses.amountCents,
        category: expenses.category,
        paymentMethod: expenses.paymentMethod,
        occurredAt: expenses.occurredAt,
        notes: expenses.notes,
        createdAt: expenses.createdAt,
      });

    return reply.code(201).send(expense);
  });
}
