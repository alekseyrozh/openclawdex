import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { app } from "electron";
import path from "path";
import * as schema from "./schema";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | null = null;

export function getDb(): Db {
  if (!_db) throw new Error("DB not initialized — call initDb() first");
  return _db;
}

export async function initDb(): Promise<void> {
  const dbPath = path.join(app.getPath("userData"), "openclawdex.db");
  const client = createClient({ url: `file:${dbPath}` });
  _db = drizzle(client, { schema });
  await migrate(_db, { migrationsFolder: path.join(__dirname, "../../drizzle") });
}
