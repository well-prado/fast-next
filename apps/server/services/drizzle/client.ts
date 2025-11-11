import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";

export async function getDatabase() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return drizzle(pool);
}
