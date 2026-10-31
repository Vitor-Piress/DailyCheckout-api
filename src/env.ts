import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: [".env.local", ".env"] });

const envSchema = z.object({
  DATABASE_URL: z.string().url("DATABASE_URL deve ser uma URL válida."),
  PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  HOST: z.string().default("0.0.0.0"),
});

export const env = envSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  PORT: process.env.PORT,
  HOST: process.env.HOST,
});
