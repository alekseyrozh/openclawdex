import { defineConfig } from "tsup";

// Main is ESM because @openai/codex-sdk is ESM-only — matching the host
// format avoids CJS interop shims for `import.meta.url` etc.
// Preload is CJS because Electron's sandboxed renderer context doesn't
// support ESM preloads; .cjs extension overrides the package's "type": "module".
// @openclawdex/shared is bundled inline because it exports TS source
// (see packages/shared/package.json) which Node can't resolve at runtime.
// @openai/codex is a CLI binary the SDK spawns — keep it on disk.
const shared = {
  outDir: "dist",
  platform: "node" as const,
  target: "node20",
  sourcemap: true,
  noExternal: ["@openclawdex/shared"],
  external: ["electron", "@openai/codex"],
};

export default defineConfig([
  { ...shared, entry: ["src/main.ts"], format: "esm", clean: true },
  {
    ...shared,
    entry: ["src/preload.ts"],
    format: "cjs",
    outExtension: () => ({ js: ".cjs" }),
  },
]);
