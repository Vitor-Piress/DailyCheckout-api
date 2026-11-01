import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../../db/client.js";
import { dailySettlementItems, dailySettlements } from "../../db/schema.js";
import {
  calculateDailySettlement,
  getDailySettlement,
} from "./settlements.service.js";

const dateQuerySchema = z.object({ date: z.iso.date() });
const closeSettlementSchema = z.object({ date: z.iso.date() });

export async function settlementsRoutes(app: FastifyInstance) {
  app.get<{ Querystring: unknown }>(
    "/settlements/daily",
    {
      schema: {
        tags: ["settlements"],
        summary: "Consulta o fechamento diário",
        querystring: {
          type: "object",
          required: ["date"],
          properties: { date: { type: "string", format: "date" } },
        },
        response: {
          200: { $ref: "DailySettlement#" },
          400: { $ref: "ErrorResponse#" },
          404: { $ref: "ErrorResponse#" },
        },
      },
    },
    async (request, reply) => {
      if (request.currentUser.role !== "admin") {
        return reply.code(403).send({
          error: "Acesso ao fechamento restrito ao perfil administrador.",
        });
      }

      const parsedQuery = dateQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.code(400).send({
          error: "Informe uma data válida no formato YYYY-MM-DD.",
          details: parsedQuery.error.issues,
        });
      }

      const settlement = await getDailySettlement(parsedQuery.data.date);
      if (!settlement) {
        return reply.code(404).send({
          error: "Fechamento diário não encontrado.",
        });
      }

      return settlement;
    },
  );

  app.post<{ Body: unknown }>(
    "/settlements/daily/close",
    {
      schema: {
        tags: ["settlements"],
        summary: "Fecha o caixa de um dia",
        body: {
          type: "object",
          required: ["date"],
          properties: { date: { type: "string", format: "date" } },
        },
        response: {
          201: { $ref: "DailySettlement#" },
          400: { $ref: "ErrorResponse#" },
          403: { $ref: "ErrorResponse#" },
          409: { $ref: "ErrorResponse#" },
        },
      },
    },
    async (request, reply) => {
      if (request.currentUser.role !== "admin") {
        return reply.code(403).send({
          error: "Acesso ao fechamento restrito ao perfil administrador.",
        });
      }

      const parsedBody = closeSettlementSchema.safeParse(request.body);
      if (!parsedBody.success) {
        return reply.code(400).send({
          error: "Informe uma data válida no formato YYYY-MM-DD.",
          details: parsedBody.error.issues,
        });
      }

      const { date } = parsedBody.data;
      const existing = await getDailySettlement(date);
      if (existing) {
        return reply.code(409).send({
          error: "O fechamento deste dia já existe.",
        });
      }

      const calculation = await calculateDailySettlement(date);
      const created = await db.transaction(async (tx) => {
        const [settlement] = await tx
          .insert(dailySettlements)
          .values({
            settlementDate: date,
            adminOwnServicesCents: calculation.adminOwnServicesCents,
            dailyOperatorsShareCents: calculation.dailyOperatorsShareCents,
            adminDailyOperatorsShareCents:
              calculation.adminDailyOperatorsShareCents,
            adminTotalDueCents: calculation.adminTotalDueCents,
            dailyOperatorsTotalDueCents:
              calculation.dailyOperatorsTotalDueCents,
            grossServicesCents: calculation.grossServicesCents,
            status: "closed",
            closedAt: new Date(),
            closedBy: request.currentUser.id,
          })
          .onConflictDoNothing({
            target: dailySettlements.settlementDate,
          })
          .returning({ id: dailySettlements.id });

        if (!settlement) {
          return false;
        }

        if (calculation.dailyOperators.length > 0) {
          await tx.insert(dailySettlementItems).values(
            calculation.dailyOperators.map((operator) => ({
              settlementId: settlement.id,
              userId: operator.userId,
              grossServicesCents: operator.grossServicesCents,
              operatorShareCents: operator.operatorShareCents,
              adminShareCents: operator.adminShareCents,
              serviceCount: operator.serviceCount,
            })),
          );
        }

        return true;
      });

      if (!created) {
        return reply.code(409).send({
          error: "O fechamento deste dia já existe.",
        });
      }

      return reply.code(201).send(await getDailySettlement(date));
    },
  );
}
