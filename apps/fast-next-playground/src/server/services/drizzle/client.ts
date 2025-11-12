import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";

export async function getDatabase() {
  return drizzle(new Database('sqlite.db'));
}
