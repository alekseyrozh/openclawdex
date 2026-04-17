import { spawn } from "child_process";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import { z } from "zod";
import { CodexModel } from "@openclawdex/shared";

/**
 * Resolve the platform-specific `codex` binary that ships inside
 * `node_modules/@openai/codex`. Mirrors the resolution logic in
 * `@openai/codex-sdk`'s `findCodexPath` so we spawn the same pinned
 * binary the SDK uses for inference — keeping the app-server
 * protocol and the exec protocol in lockstep.
 */
function findBundledCodexBinary(): string | null {
  const PLATFORM_PACKAGE: Record<string, string> = {
    "x86_64-unknown-linux-musl": "@openai/codex-linux-x64",
    "aarch64-unknown-linux-musl": "@openai/codex-linux-arm64",
    "x86_64-apple-darwin": "@openai/codex-darwin-x64",
    "aarch64-apple-darwin": "@openai/codex-darwin-arm64",
    "x86_64-pc-windows-msvc": "@openai/codex-win32-x64",
    "aarch64-pc-windows-msvc": "@openai/codex-win32-arm64",
  };

  let triple: string | null = null;
  if (process.platform === "darwin") {
    triple = process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  } else if (process.platform === "linux") {
    triple = process.arch === "arm64" ? "aarch64-unknown-linux-musl" : "x86_64-unknown-linux-musl";
  } else if (process.platform === "win32") {
    triple = process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  if (!triple) return null;

  const platformPkg = PLATFORM_PACKAGE[triple];
  try {
    const codexPkgJson = require.resolve("@openai/codex/package.json");
    const codexRequire = createRequire(codexPkgJson);
    const platformPkgJson = codexRequire.resolve(`${platformPkg}/package.json`);
    const binName = process.platform === "win32" ? "codex.exe" : "codex";
    const bin = path.join(path.dirname(platformPkgJson), "vendor", triple, "codex", binName);
    return fs.existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

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
  const bin = findBundledCodexBinary();
  if (!bin) throw new Error("Codex binary not found — is @openai/codex installed?");

  return new Promise<CodexModel[]>((resolve, reject) => {
    const child = spawn(bin, ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });

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
          finish(() => resolve(parsed.data.data.filter((m) => !m.hidden)));
        }
      }
    });

    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          clientInfo: { name: "openclawdex", version: "0.2.1" },
          capabilities: { experimentalApi: true },
        },
      }) + "\n",
    );
  });
}
