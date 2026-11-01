import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { checkDatabaseConnection } from "./db/client.js";
import { serviceTypesRoutes } from "./modules/service-types/service-types.routes.js";
import { serviceRecordsRoutes } from "./modules/service-records/service-records.routes.js";
import { expensesRoutes } from "./modules/expenses/expenses.routes.js";
import { reportsRoutes } from "./modules/reports/reports.routes.js";
import { env } from "./env.js";
import { registerSchemas } from "./docs/schemas.js";
import { authenticateRequest } from "./auth.js";

export async function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.addHook("onRequest", async (request, reply) => {
    if (request.method === "OPTIONS") {
      return;
    }

    if (
      request.url === "/health" ||
      request.url === "/health/db" ||
      request.url.startsWith("/docs")
    ) {
      return;
    }

    const result = await authenticateRequest(request.headers.authorization);
    if ("statusCode" in result) {
      return reply.code(result.statusCode).send({ error: result.error });
    }
    request.currentUser = result;

    if (request.url.startsWith("/reports/periodic") && result.role !== "admin") {
      return reply.code(403).send({
        error: "Acesso restrito ao perfil administrador.",
      });
    }
  });

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
  });
  await app.register(swagger, {
    refResolver: {
      buildLocalReference: (json, _baseUri, _fragment, i) =>
        typeof json.$id === "string" ? json.$id : `schema-${i}`,
    },
    openapi: {
      info: {
        title: "DailyCheckout API",
        description: "API para registro de serviços, despesas e relatórios.",
        version: "1.0.0",
      },
      tags: [
        { name: "health", description: "Verificação da API e do banco." },
        { name: "service-types", description: "Catálogo de serviços." },
        { name: "service-records", description: "Atendimentos realizados." },
        { name: "expenses", description: "Despesas da barbearia." },
        { name: "reports", description: "Relatórios financeiros." },
      ],
    },
  });
  await app.register(swaggerUi, {
    routePrefix: "/docs",
  });
  await registerSchemas(app);

  app.get(
    "/health",
    {
      schema: {
        tags: ["health"],
        summary: "Verifica se a API está disponível",
        response: {
          200: {
            type: "object",
            properties: { status: { type: "string", example: "ok" } },
          },
        },
      },
    },
    async () => ({ status: "ok" }),
  );

  app.get(
    "/health/db",
    {
      schema: {
        tags: ["health"],
        summary: "Verifica a conexão com o PostgreSQL",
        response: {
          200: {
            type: "object",
            properties: {
              status: { type: "string", example: "ok" },
              database: { type: "string", example: "ok" },
            },
          },
        },
      },
    },
    async () => {
      await checkDatabaseConnection();
      return { status: "ok", database: "ok" };
    },
  );

  app.register(serviceTypesRoutes);
  app.register(serviceRecordsRoutes);
  app.register(expensesRoutes);
  app.register(reportsRoutes);

  return app;
}
