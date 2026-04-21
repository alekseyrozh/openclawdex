/**
 * Namespaced debug logging via the browser's native verbose log level.
 *
 * ## Usage
 *
 * ```ts
 * const debug = createDebug("git-branch");
 * debug("fetch thread=%s cwd=%s", threadId, cwd);
 * ```
 *
 * ## Viewing logs
 *
 * Debug output is emitted via `console.debug`, which Chromium's devtools
 * hides by default. To see it:
 *
 * 1. Open devtools (Cmd+Option+I)
 * 2. Console panel → "Default levels" dropdown → check "Verbose"
 * 3. Optional: type `[git-branch]` in the filter box to narrow down
 *
 * No localStorage toggles, no namespace patterns — the browser already
 * has a log-level filter built in, so we use it.
 *
 * ## Production
 *
 * In `import.meta.env.PROD` builds this factory returns a no-op. Vite
 * replaces `import.meta.env.DEV` with a literal `false` at build time,
 * so the `console.debug` code path is dead and eliminated by the
 * minifier — debug calls cost nothing at runtime in prod.
 *
 * Call-site argument expressions are still evaluated (the bundler
 * can't prove they're side-effect-free), so avoid expensive computation
 * in debug arguments on hot paths.
 */

type DebugFn = (...args: unknown[]) => void;

const NOOP: DebugFn = () => {};

export function createDebug(namespace: string): DebugFn {
  if (!import.meta.env.DEV) return NOOP;
  // Bind so line numbers in devtools point at the call site, not at a
  // wrapper function here. `console.debug` is the browser's "verbose"
  // level — hidden from the default Console view.
  // eslint-disable-next-line no-console
  return console.debug.bind(console, `[${namespace}]`);
}
