import type { Config } from "drizzle-kit";
import os from "os";
import path from "path";

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: path.join(os.homedir(), "Library/Application Support/@openclawdex/desktop/openclawdex.db"),
  },
} satisfies Config;
