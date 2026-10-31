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
  date: z.iso.date(),
});

export async function expensesRoutes(app: FastifyInstance) {
  app.get<{ Querystring: unknown }>("/expenses", async (request, reply) => {
    const parsedQuery = listExpensesQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: "Informe uma data válida no formato YYYY-MM-DD.",
        details: parsedQuery.error.issues,
      });
    }

    const { date } = parsedQuery.data;
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
          sql`(${expenses.occurredAt} AT TIME ZONE 'America/Sao_Paulo')::date = ${date}::date`,
          isNull(expenses.canceledAt),
        ),
      )
      .orderBy(expenses.occurredAt);
  });

  app.post<{ Body: unknown }>("/expenses", async (request, reply) => {
    const parsedBody = createExpenseSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return reply.code(400).send({
        error: "Dados inválidos.",
        details: parsedBody.error.issues,
      });
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
