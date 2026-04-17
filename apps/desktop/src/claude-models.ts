import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeModel } from "@openclawdex/shared";
import { z } from "zod";

/**
 * Zod-validated `ModelInfo[]` as returned by the Agent SDK's
 * `Query.supportedModels()`. We validate the wire shape at the
 * boundary because the SDK can add fields upstream at any time.
 */
const ClaudeModelList = z.array(ClaudeModel);

/**
 * Process-wide cache. A single fetch costs ~1–2s (cold-start of the
 * `claude` CLI) so we serve every call after the first from memory.
 */
let cache: Promise<z.infer<typeof ClaudeModelList>> | null = null;

export function listClaudeModels(claudePath: string): Promise<z.infer<typeof ClaudeModelList>> {
  if (!cache) cache = fetchClaudeModels(claudePath);
  return cache;
}

/**
 * Spawn a throwaway streaming Claude query, ask for its model list via
 * the SDK's control protocol, then interrupt before any turn runs.
 *
 * GOTCHA: `supportedModels()` is a **control request**, so the query
 * must be in streaming-input mode — that's what the async-iterable
 * `prompt` here enables. A plain-string prompt would disable control
 * requests entirely.
 *
 * GOTCHA: the prompt iterable MUST NOT yield, otherwise the SDK will
 * start a real turn and run up against the user's Claude plan.
 * Interrupting immediately after the model list is back is enough to
 * shut the subprocess down cleanly.
 */
async function fetchClaudeModels(
  claudePath: string,
): Promise<z.infer<typeof ClaudeModelList>> {
  // Never-yielding async generator. It stays open until we call
  // `q.interrupt()` below; the SDK waits on it for the first user turn.
  const neverYieldingPrompt = async function* (): AsyncIterable<SDKUserMessage> {
    // Block on a promise that never resolves. Awaiting a Promise created
    // with `new Promise(() => {})` is cheap — no polling — and the
    // generator is disposed when the query is interrupted.
    await new Promise<void>(() => {});
  };

  const q = query({
    prompt: neverYieldingPrompt(),
    options: {
      pathToClaudeCodeExecutable: claudePath,
      // No cwd / resume / permission mode — we never execute a turn.
    },
  });

  try {
    const raw = await q.supportedModels();
    const parsed = ClaudeModelList.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`supportedModels schema mismatch: ${parsed.error.message}`);
    }
    return parsed.data;
  } finally {
    // Shut the throwaway subprocess down. Swallow errors — if interrupt
    // fails (e.g. already torn down), the child will exit on its own
    // when the generator is garbage-collected.
    try {
      await q.interrupt();
    } catch {
      /* ignore */
    }
  }
}
