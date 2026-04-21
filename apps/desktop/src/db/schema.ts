import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const projectFolders = sqliteTable("project_folders", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  folderPath: text("folder_path").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const knownThreads = sqliteTable("known_threads", {
  sessionId: text("session_id").primaryKey(),
  createdAt: integer("created_at").notNull(),
  projectId: text("project_id"),
  customName: text("custom_name"),
  contextStats: text("context_stats"),
  pinned: integer("pinned", { mode: "boolean" }).default(false),
  // Epoch ms when the thread was archived. This is the single source
  // of truth for archive state: non-null = archived, null = active.
  // Unarchiving sets it back to null (we don't preserve history — the
  // `archived` boolean column used to, but collapsing into one column
  // wins on simplicity and a re-archive restamps anyway). Sorts the
  // archive list most-recent-first.
  archivedAt: integer("archived_at"),
  // Which agent backend this thread runs on. Defaults to 'claude' so
  // rows that existed before multi-provider support get backfilled correctly
  // by the ALTER TABLE … DEFAULT migration.
  provider: text("provider").notNull().default("claude"),
  sortOrder: integer("sort_order").notNull().default(0),
});
