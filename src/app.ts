import Fastify from "fastify";
import { checkDatabaseConnection } from "./db/client.js";
import { serviceTypesRoutes } from "./modules/service-types/service-types.routes.js";
import { serviceRecordsRoutes } from "./modules/service-records/service-records.routes.js";

export function buildApp() {
  const app = Fastify({
    logger: true,
  });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.get("/health/db", async () => {
    await checkDatabaseConnection();
    return { status: "ok", database: "ok" };
  });

  app.register(serviceTypesRoutes);
  app.register(serviceRecordsRoutes);

  return app;
}
