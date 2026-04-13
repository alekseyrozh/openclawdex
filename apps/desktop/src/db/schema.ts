import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const knownThreads = sqliteTable("known_threads", {
  sessionId: text("session_id").primaryKey(),
  createdAt: integer("created_at").notNull(), // unix ms
});
