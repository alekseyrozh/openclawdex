import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: integer("created_at").notNull(),
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
});
