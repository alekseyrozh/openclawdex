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
 * the SDK's control protocol, then shut it down before any turn runs.
 *
 * GOTCHA: `supportedModels()` is a **control request**, so the query
 * must be in streaming-input mode — that's what the async-iterable
 * `prompt` here enables. A plain-string prompt would disable control
 * requests entirely.
 *
 * GOTCHA: the prompt iterable must stay open until we're done (so the
 * SDK doesn't try to run a real turn against the user's Claude plan)
 * but must also terminate cleanly when we're finished — otherwise the
 * generator frame is left parked on an unresolvable Promise and only
 * frees on GC. We solve that with a resolvable "done" promise the
 * outer function flips in its `finally`.
 */
async function fetchClaudeModels(
  claudePath: string,
): Promise<z.infer<typeof ClaudeModelList>> {
  // A promise we'll resolve in the outer finally. The generator awaits
  // it and then returns, allowing the SDK's prompt reader to see
  // end-of-stream and the frame to be freed.
  let markDone: () => void = () => {};
  const donePromise = new Promise<void>((resolve) => { markDone = resolve; });

  const singleShotPrompt = async function* (): AsyncIterable<SDKUserMessage> {
    await donePromise;
    // Generator returns here — no messages yielded, so the SDK never
    // starts a turn. Execution falls out of the function body cleanly.
  };

  const q = query({
    prompt: singleShotPrompt(),
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
    // Release the generator so its frame can be GC'd immediately, then
    // close out the SDK subprocess. Both are best-effort: if interrupt
    // rejects (already torn down), the child still exits once the
    // prompt generator completes.
    markDone();
    try {
      await q.interrupt();
    } catch {
      /* ignore */
    }
  }
}
