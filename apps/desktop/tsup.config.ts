import { defineConfig } from "tsup";

/**
 * Bundles the Electron main process + preload into CJS.
 *
 * Why bundle at all: `@openai/codex-sdk` is ESM-only, but Electron's main
 * process loads the entry as CJS. tsup (via esbuild) converts the SDK's
 * ESM output to CJS at build time so `require("@openai/codex-sdk")` works
 * at runtime.
 *
 * Everything else stays external — deps live in node_modules and are
 * required at runtime, which keeps the bundle small and doesn't touch
 * native-binary packages (e.g. @libsql/client).
 */
const shared = {
  format: "cjs" as const,
  outDir: "dist",
  platform: "node" as const,
  target: "node20",
  sourcemap: true,
  external: ["electron"],
};

export default defineConfig([
  // Main process bundle — inlines @openai/codex-sdk (ESM-only) and
  // @openclawdex/shared so Node-CJS can require the entry.
  {
    ...shared,
    entry: ["src/main.ts"],
    clean: true,
    noExternal: ["@openai/codex-sdk", "@openclawdex/shared"],
    // The Codex CLI package is a binary the SDK spawns at runtime; keep
    // it as a plain dep on disk.
    external: [...shared.external, "@openai/codex"],
    // @openai/codex-sdk calls `createRequire(import.meta.url)` internally.
    // When esbuild bundles ESM → CJS it stubs `import_meta = {}`, so
    // `.url` is undefined and createRequire throws at load. Define
    // `import.meta.url` to a runtime expression we seed via banner.
    esbuildOptions(opts) {
      opts.define = {
        ...opts.define,
        "import.meta.url": "__importMetaUrl",
      };
      opts.banner = {
        ...opts.banner,
        js: `const __importMetaUrl = require("url").pathToFileURL(__filename).toString();`,
      };
    },
  },
  // Preload runs in a sandboxed renderer context — no __filename,
  // no Node APIs beyond contextBridge/ipcRenderer. Bundle @openclawdex/shared
  // so preload doesn't try to resolve a workspace package at runtime,
  // but skip the codex-sdk + banner.
  {
    ...shared,
    entry: ["src/preload.ts"],
    noExternal: ["@openclawdex/shared"],
  },
]);
