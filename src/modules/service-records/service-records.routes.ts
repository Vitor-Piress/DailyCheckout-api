import type { FastifyInstance } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { appUsers, serviceRecords, serviceTypes } from "../../db/schema.js";

const createServiceRecordSchema = z.object({
  serviceTypeId: z.uuid(),
  paymentMethod: z.enum([
    "cash",
    "pix",
    "credit_card",
    "debit_card",
    "other",
  ]),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  notes: z.string().trim().max(500).optional(),
});

const listServiceRecordsQuerySchema = z.object({
  date: z.iso.date(),
});

export async function serviceRecordsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: unknown }>(
    "/service-records",
    {
      schema: {
        tags: ["service-records"],
        summary: "Lista os atendimentos de um dia",
        querystring: {
          type: "object",
          required: ["date"],
          properties: { date: { type: "string", format: "date" } },
        },
        response: {
          200: { type: "array", items: { $ref: "ServiceRecord#" } },
          400: { $ref: "ErrorResponse#" },
        },
      },
    },
    async (request, reply) => {
    const parsedQuery = listServiceRecordsQuerySchema.safeParse(request.query);

    if (!parsedQuery.success) {
      return reply.code(400).send({
        error: "Informe uma data válida no formato YYYY-MM-DD.",
        details: parsedQuery.error.issues,
      });
    }

    const { date } = parsedQuery.data;
    const authorFilter =
      request.currentUser.role === "admin"
        ? undefined
        : eq(serviceRecords.createdBy, request.currentUser.id);

    return db
      .select({
        id: serviceRecords.id,
        serviceTypeId: serviceRecords.serviceTypeId,
        serviceName: serviceTypes.name,
        priceCents: serviceRecords.priceCents,
        paymentMethod: serviceRecords.paymentMethod,
        occurredAt: serviceRecords.occurredAt,
        notes: serviceRecords.notes,
        createdAt: serviceRecords.createdAt,
        createdBy: {
          id: appUsers.id,
          name: appUsers.name,
          role: appUsers.role,
        },
      })
      .from(serviceRecords)
      .innerJoin(serviceTypes, eq(serviceRecords.serviceTypeId, serviceTypes.id))
      .leftJoin(appUsers, eq(serviceRecords.createdBy, appUsers.id))
      .where(
        and(
          sql`(${serviceRecords.occurredAt} AT TIME ZONE 'America/Sao_Paulo')::date = ${date}::date`,
          isNull(serviceRecords.canceledAt),
          authorFilter,
        ),
      )
      .orderBy(serviceRecords.occurredAt);
    },
  );

  app.post<{ Body: unknown }>(
    "/service-records",
    {
      schema: {
        tags: ["service-records"],
        summary: "Registra um atendimento",
        body: { $ref: "CreateServiceRecordInput#" },
        response: {
          201: { $ref: "ServiceRecord#" },
          400: { $ref: "ErrorResponse#" },
          404: { $ref: "ErrorResponse#" },
        },
      },
    },
    async (request, reply) => {
    const parsedBody = createServiceRecordSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return reply.code(400).send({
        error: "Dados inválidos.",
        details: parsedBody.error.issues,
        },
      );
    }

    const { serviceTypeId, paymentMethod, occurredAt, notes } = parsedBody.data;
    const [serviceType] = await db
      .select({
        id: serviceTypes.id,
        priceCents: serviceTypes.priceCents,
      })
      .from(serviceTypes)
      .where(
        and(eq(serviceTypes.id, serviceTypeId), eq(serviceTypes.active, true)),
      )
      .limit(1);

    if (!serviceType) {
      return reply.code(404).send({
        error: "Serviço não encontrado ou inativo.",
      });
    }

    const [serviceRecord] = await db
      .insert(serviceRecords)
      .values({
        serviceTypeId: serviceType.id,
        priceCents: serviceType.priceCents,
        paymentMethod,
        occurredAt: occurredAt ? new Date(occurredAt) : undefined,
        createdBy: request.currentUser.id,
        notes: notes || null,
      })
      .returning({
        id: serviceRecords.id,
        serviceTypeId: serviceRecords.serviceTypeId,
        priceCents: serviceRecords.priceCents,
        paymentMethod: serviceRecords.paymentMethod,
        occurredAt: serviceRecords.occurredAt,
        notes: serviceRecords.notes,
        createdAt: serviceRecords.createdAt,
      });

    return reply.code(201).send({
      ...serviceRecord,
      createdBy: {
        id: request.currentUser.id,
        name: request.currentUser.name,
        role: request.currentUser.role,
      },
    });
  });
}
