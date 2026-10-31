import dotenv from "dotenv";
import { defineConfig } from "drizzle-kit";

dotenv.config({ path: [".env.local", ".env"] });

const databaseUrl = process.env.DATABASE_URL_UNPOOLED;

if (!databaseUrl) {
  throw new Error("DATABASE_URL_UNPOOLED é obrigatória para migrations.");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
