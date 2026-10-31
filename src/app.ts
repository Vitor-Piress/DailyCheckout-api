import Fastify from "fastify";
import { checkDatabaseConnection } from "./db/client.js";

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

  return app;
}
