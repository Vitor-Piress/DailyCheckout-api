import type { FastifyInstance } from "fastify";
import { asc, eq } from "drizzle-orm";
import { db } from "../../db/client.js";
import { serviceTypes } from "../../db/schema.js";

export async function serviceTypesRoutes(app: FastifyInstance) {
  app.get(
    "/service-types",
    {
      schema: {
        tags: ["service-types"],
        summary: "Lista os serviços ativos",
        response: {
          200: {
            type: "array",
            items: { $ref: "ServiceType#" },
          },
        },
      },
    },
    async () => {
    return db
      .select({
        id: serviceTypes.id,
        name: serviceTypes.name,
        description: serviceTypes.description,
        priceCents: serviceTypes.priceCents,
      })
      .from(serviceTypes)
      .where(eq(serviceTypes.active, true))
      .orderBy(asc(serviceTypes.name));
    },
  );
}
