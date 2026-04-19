/**
 * Extract `<proposed_plan>…</proposed_plan>` blocks from Codex
 * assistant-message text.
 *
 * The tag contract is prompt-driven (see `CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS`
 * in `user-mode.ts`) — Codex itself parses the assistant message with a
 * regex to emit the live `plan` item, so the rollout file stores the
 * raw `<proposed_plan>` block inside the assistant message. When we
 * replay history we need to do the same extraction so the UI can render
 * the plan as a first-class card instead of leaking the tags into the
 * transcript.
 *
 * Using `/gi` with the global flag so we catch every block if the agent
 * ever emits more than one per turn, even though the prompt asks for
 * exactly one.
 */
const PROPOSED_PLAN_REGEX = /<proposed_plan>\s*([\s\S]*?)\s*<\/proposed_plan>/gi;

export function extractProposedPlans(text: string): { clean: string; plans: string[] } {
  const plans: string[] = [];
  const clean = text
    .replace(PROPOSED_PLAN_REGEX, (_match, body: string) => {
      const trimmed = body.trim();
      if (trimmed.length > 0) plans.push(trimmed);
      return "";
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { clean, plans };
}
