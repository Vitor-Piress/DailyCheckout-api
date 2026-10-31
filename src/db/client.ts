import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { env } from "../env.js";

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

export const db = drizzle(pool);

export async function checkDatabaseConnection() {
  await db.execute(sql`select 1`);
}
