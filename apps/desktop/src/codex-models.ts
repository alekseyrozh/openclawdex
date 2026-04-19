import { spawn } from "child_process";
import { app } from "electron";
import { z } from "zod";
import { CodexModel } from "@openclawdex/shared";

/**
 * Response envelope for the `model/list` RPC. The `data` array is the
 * list of models; `nextCursor` is a pagination hint we don't use
 * (the list is always short enough to fit in one page).
 */
const ModelListResponse = z.object({
  data: z.array(CodexModel),
  nextCursor: z.string().nullable().optional(),
});

/**
 * Cache the models across calls in a single app lifetime. Models rarely
 * change, and spawning `codex app-server` + round-tripping JSON-RPC adds
 * ~500ms on a cold call; not worth paying every time a user opens the
 * picker.
 */
let cache: Promise<CodexModel[]> | null = null;

/**
 * Order Codex models newest-first using Codex's own `upgrade` graph.
 * Each older model carries an `upgrade` field pointing at its
 * successor; a model with no upgrade is a sink (newest). We sort by
 * generation depth — distance (in upgrade hops) to a sink — so the
 * newest models come first and chains stay correctly ordered even if
 * Codex ships intermediate versions in the future.
 */
function sortByUpgradeGraph(models: CodexModel[]): CodexModel[] {
  const byId = new Map(models.map((m) => [m.model, m]));
  const depthCache = new Map<string, number>();
  const depth = (id: string, seen = new Set<string>()): number => {
    const cached = depthCache.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    const up = byId.get(id)?.upgrade;
    const d = up && byId.has(up) ? depth(up, seen) + 1 : 0;
    depthCache.set(id, d);
    return d;
  };
  return [...models].sort((a, b) => depth(a.model) - depth(b.model));
}

export function listCodexModels(): Promise<CodexModel[]> {
  if (!cache) cache = fetchCodexModels();
  return cache;
}

/**
 * Spawn `codex app-server`, run the JSON-RPC `initialize` + `model/list`
 * handshake, and return the visible (non-hidden) models.
 *
 * GOTCHA: `app-server` is an experimental protocol. It rejects any
 * request before `initialize` with `{"code":-32600,"message":"Not
 * initialized"}`. We send `experimentalApi: true` so method gating
 * doesn't silently drop `model/list`.
 */
async function fetchCodexModels(): Promise<CodexModel[]> {
  return new Promise<CodexModel[]>((resolve, reject) => {
    const child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });

    let stdoutBuf = "";
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("Codex app-server timed out after 10s"));
    }, 10_000);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      fn();
    };

    child.on("error", (err) => finish(() => reject(err)));
    child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
    child.on("exit", (code) => {
      if (settled) return;
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      finish(() => reject(new Error(`codex app-server exited ${code}: ${stderr}`)));
    });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf-8");
      let nl: number;
      while ((nl = stdoutBuf.indexOf("\n")) >= 0) {
        const line = stdoutBuf.slice(0, nl).trim();
        stdoutBuf = stdoutBuf.slice(nl + 1);
        if (!line) continue;

        let msg: { id?: number; result?: unknown; error?: { message?: string } };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }

        if (msg.id === 0 && msg.result) {
          // initialize acknowledged — now ask for models
          child.stdin.write(
            JSON.stringify({ jsonrpc: "2.0", id: 1, method: "model/list", params: {} }) + "\n",
          );
        } else if (msg.id === 1) {
          if (msg.error) {
            finish(() => reject(new Error(`model/list: ${msg.error?.message ?? "unknown error"}`)));
            return;
          }
          const parsed = ModelListResponse.safeParse(msg.result);
          if (!parsed.success) {
            finish(() => reject(new Error(`model/list schema mismatch: ${parsed.error.message}`)));
            return;
          }
          finish(() =>
            resolve(
              sortByUpgradeGraph(parsed.data.data.filter((m) => !m.hidden)),
            ),
          );
        }
      }
    });

    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          clientInfo: { name: "openclawdex", version: app.getVersion() },
          capabilities: { experimentalApi: true },
        },
      }) + "\n",
    );
  });
}
