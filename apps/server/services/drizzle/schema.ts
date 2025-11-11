import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const example = sqliteTable("example", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(Math.floor(Date.now() / 1000)),
});
