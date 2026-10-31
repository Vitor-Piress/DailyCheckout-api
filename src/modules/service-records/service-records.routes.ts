import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client.js";
import { serviceRecords, serviceTypes } from "../../db/schema.js";

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

export async function serviceRecordsRoutes(app: FastifyInstance) {
  app.post<{ Body: unknown }>("/service-records", async (request, reply) => {
    const parsedBody = createServiceRecordSchema.safeParse(request.body);

    if (!parsedBody.success) {
      return reply.code(400).send({
        error: "Dados inválidos.",
        details: parsedBody.error.issues,
      });
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

    return reply.code(201).send(serviceRecord);
  });
}
