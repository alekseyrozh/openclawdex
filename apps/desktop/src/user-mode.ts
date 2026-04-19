/**
 * Central mapping between our UI-level {@link UserMode} and the
 * native permission knobs each backend expects. One source of truth so
 * the Claude side, Codex side, and history-file readers can't drift.
 */

import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { UserMode } from "@openclawdex/shared";

// ── Claude ───────────────────────────────────────────────────

/**
 * Permission mode we pass to the SDK's `query()` call and to
 * `q.setPermissionMode()` for live mode flips.
 *
 * Only `plan` gets its own native SDK mode (we need it for the
 * `ExitPlanMode` tool and read-only SDK-level enforcement). The
 * other three all map to SDK `"default"`, which makes the SDK call
 * `canUseTool` for every tool so our gate (which reads
 * `this.userMode`) is the sole authority.
 *
 * Why this is the only way, verified empirically (2026-04):
 *
 * | Combo                         | Edit    | Bash    |
 * | flag=false + SDK `default`    | prompts | prompts |
 * | flag=true  + SDK `default`    | prompts | prompts |
 * | flag=false + SDK `acceptEdits`| silent  | silent  |  ← surprise
 * | flag=true  + SDK `acceptEdits`| silent  | silent  |
 * | flag=true  + SDK `bypass`     | silent  | silent  |
 *
 * SDK `"acceptEdits"` is misleadingly named — it's effectively
 * "bypass-lite" and auto-accepts Bash (including `rm`) without
 * routing through `canUseTool`. There is NO SDK combination that
 * yields "edits silent, Bash prompts"; that granularity only lives
 * in our gate.
 *
 * `bypassPermissions` at the SDK layer additionally requires
 * `allowDangerouslySkipPermissions: true` at launch, which the SDK
 * refuses to flip to mid-stream on sessions that didn't have it.
 * Using the flag "just in case" doesn't help either — it doesn't
 * make `acceptEdits` prompt for Bash.
 *
 * Conclusion: keep the SDK in `"default"` for ask/acceptEdits/
 * bypass, let our `canUseTool` gate decide. Mode flips among the
 * three are pure local-state updates — no SDK round-trip, no
 * session restart, no flaky propagation.
 *
 * Known tradeoff: the rollout file records `permissionMode:
 * "default"` for all three, so resume can't distinguish ask from
 * acceptEdits from bypass. Fix later by persisting `userMode` on
 * `known_threads` and preferring it over rollout on resume.
 */
export const CLAUDE_MODE: Record<UserMode, PermissionMode> = {
  plan: "plan",
  ask: "default",
  acceptEdits: "default",
  bypassPermissions: "default",
};

/**
 * Derive {@link UserMode} from the `permissionMode` field recorded on
 * a Claude rollout entry. Unknown values collapse to "bypassPermissions"
 * so existing sessions never silently get more restrictive than they
 * were running as.
 */
export function claudePermissionModeToUserMode(mode: string | undefined): UserMode {
  switch (mode) {
    case "plan":
      return "plan";
    case "default":
      return "ask";
    case "acceptEdits":
      return "acceptEdits";
    case "bypassPermissions":
      return "bypassPermissions";
    default:
      return "bypassPermissions";
  }
}

// ── Codex ────────────────────────────────────────────────────

export type CodexApprovalPolicy = "never" | "on-request" | "on-failure" | "untrusted";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface CodexSandboxPolicy {
  type: "readOnly" | "workspaceWrite" | "dangerFullAccess";
  networkAccess?: boolean;
  writableRoots?: string[];
}

export type CodexCollaborationMode = "default" | "plan";

export interface CodexCollaborationSettings {
  model: string;
  reasoning_effort: string;
  developer_instructions: string;
}

export interface CodexModeOptions {
  approvalPolicy: CodexApprovalPolicy;
  sandbox: CodexSandboxMode;
  sandboxPolicy: CodexSandboxPolicy;
  /**
   * Codex has a native Plan/Default collaboration mode that gates the
   * `request_user_input` tool and ships plan-mode developer
   * instructions. We always set this explicitly on `turn/start` so
   * switching *out* of plan mode cleanly overrides the server's
   * previous mode state.
   *
   * `settings` is required by the app-server (turn/start fails with
   * "missing field settings" otherwise). `model` and `reasoning_effort`
   * mirror the session's active values; `developer_instructions` is
   * picked per mode from the constants below.
   */
  collaborationMode: CodexCollaborationMode;
  collaborationSettings: CodexCollaborationSettings;
}

/**
 * Plan-mode developer instructions. Declares the mode, forbids
 * mutations, and tells the agent to produce a written plan. We
 * deliberately avoid any app-specific output format (e.g. t3code's
 * `<proposed_plan>` tag) so consumers can evolve the rendering
 * contract without changing what the agent is told.
 */
const CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS = `<collaboration_mode># Plan Mode

You are in Plan mode. The user wants your assessment or proposed plan before any implementation happens.

## What to do
- Explore the repo, read files, run non-mutating commands to understand the situation.
- Ask clarifying questions when intent or constraints are genuinely ambiguous (use the \`request_user_input\` tool when available).
- Produce a decision-complete plan: goal, approach, files/interfaces affected, edge cases, and acceptance criteria. It should leave no decisions to the implementer.

## Presenting the final plan
When you are ready to present the official plan, wrap it in a \`<proposed_plan>\` block so the client can render it as a distinct card:

1. The opening tag must be on its own line.
2. Start the plan content on the next line (no text on the same line as the tag).
3. The closing tag must be on its own line.
4. Use Markdown inside the block.
5. Keep the tags exactly as \`<proposed_plan>\` and \`</proposed_plan>\` (do not translate or rename them).

Example:

<proposed_plan>
plan content
</proposed_plan>

You may include brief prose before or after the block (for example, a one-line summary). Do not ask "should I proceed?" — the client surfaces an approve / revise UI automatically. Only emit **one** \`<proposed_plan>\` block per turn, and only when the plan is genuinely complete.

## What NOT to do
- Do not edit, write, or patch files.
- Do not run formatters, linters, migrations, codegen, or any command that mutates repo-tracked state.
- Do not start implementing and then claim the plan is "in progress" — a plan is a complete proposal, not partial execution.

## About the \`update_plan\` tool
\`update_plan\` is a checklist / progress / TODO tool and is **unavailable in Plan mode** — calling it will error. Do not try to persist the plan with it. Use the \`<proposed_plan>\` block above instead, and do not mention that \`update_plan\` is blocked.

Plan mode ends only when new developer instructions change the active collaboration_mode. User intent, tone, or imperative language do not exit plan mode.
</collaboration_mode>`;

/**
 * Default-mode developer instructions. Verbatim from Codex's own
 * app-server defaults (as observed in rollout files) so we don't
 * accidentally weaken or redefine the server's built-in behavior when
 * toggling back out of plan mode.
 */
const CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS = `<collaboration_mode># Collaboration Mode: Default

You are now in Default mode. Any previous instructions for other modes (e.g. Plan mode) are no longer active.

Your active mode changes only when new developer instructions with a different \`<collaboration_mode>...</collaboration_mode>\` change it; user requests or tool descriptions do not change mode by themselves. Known mode names are Default and Plan.

## request_user_input availability

The \`request_user_input\` tool is unavailable in Default mode. If you call it while in Default mode, it will return an error.

In Default mode, strongly prefer making reasonable assumptions and executing the user's request rather than stopping to ask questions. If you absolutely must ask a question because the answer cannot be discovered from local context and a reasonable assumption would be risky, ask the user directly with a concise plain-text question. Never write a multiple choice question as a textual assistant message.

## \`<proposed_plan>\` is Plan-mode-only

The \`<proposed_plan>\` … \`</proposed_plan>\` wrapper is a Plan-mode-only formatting convention. Do not emit it in Default mode, even if the user asks for "a plan" or for you to "plan first." Explain plans in normal Markdown prose or bullets instead. If the user wants the proposed-plan flow, they can switch to Plan mode.
</collaboration_mode>`;

function developerInstructionsFor(mode: CodexCollaborationMode): string {
  return mode === "plan"
    ? CODEX_PLAN_MODE_DEVELOPER_INSTRUCTIONS
    : CODEX_DEFAULT_MODE_DEVELOPER_INSTRUCTIONS;
}

/**
 * Codex has three orthogonal axes (`approvalPolicy`, `sandboxPolicy`,
 * `collaborationMode`); we collapse all three into one UserMode by
 * picking the combination that most closely matches the UI label.
 * `writableRoots` is rooted at `cwd` when we have one.
 *
 * Plan mode combines a read-only sandbox (defense in depth) with the
 * native `collaborationMode: "plan"` (agent-aware) so the model knows
 * to produce a plan rather than execute one.
 *
 * `model` and `effort` feed into `collaborationSettings`, which the
 * app-server requires alongside the mode flag on `turn/start`.
 */
export function codexModeOptions(
  mode: UserMode,
  cwd: string | undefined,
  model: string | undefined,
  effort: string | undefined,
): CodexModeOptions {
  const workspaceWrite: CodexSandboxPolicy = {
    type: "workspaceWrite",
    networkAccess: true,
    ...(cwd && { writableRoots: [cwd] }),
  };
  const buildSettings = (cmode: CodexCollaborationMode): CodexCollaborationSettings => ({
    model: model ?? "codex",
    reasoning_effort: effort ?? "medium",
    developer_instructions: developerInstructionsFor(cmode),
  });
  switch (mode) {
    case "plan":
      // Agent-aware plan mode + hard sandbox. No approvals since
      // the agent is producing a plan, not running things.
      return {
        approvalPolicy: "never",
        sandbox: "read-only",
        sandboxPolicy: { type: "readOnly" },
        collaborationMode: "plan",
        collaborationSettings: buildSettings("plan"),
      };
    case "ask":
      // "untrusted" = harness escalates every command that isn't in
      // Codex's built-in trusted allowlist (ls, cat, etc.). Paired
      // with *workspace-write* — NOT read-only — because Codex's
      // built-in `read_only.md` prompt literally tells the agent
      // "The sandbox only permits reading files," which makes the
      // agent refuse edits before even trying (no apply_patch = no
      // approval RPC = user sees "can't edit, session is read-only"
      // and wonders why Ask mode blocked them).
      //
      // Under untrusted, core/src/safety.rs:55 returns AskUser for
      // every apply_patch regardless of sandbox, so workspace-write
      // doesn't weaken the approval gate — it just tells the agent
      // edits are on the table so it'll try, hit the approval, and
      // the user gets the confirmation dialog they expected.
      return {
        approvalPolicy: "untrusted",
        sandbox: "workspace-write",
        sandboxPolicy: workspaceWrite,
        collaborationMode: "default",
        collaborationSettings: buildSettings("default"),
      };
    case "acceptEdits":
      // Same server policy as `ask` (untrusted + workspace-write) —
      // the server escalates every non-trusted command AND every
      // apply_patch. We distinguish acceptEdits from ask purely on
      // the client side in `codex.ts`: file-change approval RPCs get
      // auto-approved, command approvals still surface the card.
      // Gets us parity with Claude's acceptEdits (edits silent,
      // shell prompts), using Codex's built-in trusted-command
      // allowlist for the safe-read carve-out.
      return {
        approvalPolicy: "untrusted",
        sandbox: "workspace-write",
        sandboxPolicy: workspaceWrite,
        collaborationMode: "default",
        collaborationSettings: buildSettings("default"),
      };
    case "bypassPermissions":
      // True bypass — no approvals AND no sandbox limits. Users
      // selecting this know they want the agent off the leash; if
      // they wanted "no prompts but still sandboxed" we'd need a
      // separate mode.
      return {
        approvalPolicy: "never",
        sandbox: "danger-full-access",
        sandboxPolicy: { type: "dangerFullAccess" },
        collaborationMode: "default",
        collaborationSettings: buildSettings("default"),
      };
  }
}

/**
 * Derive {@link UserMode} from a Codex `turn_context` rollout entry.
 *
 * Prefer `collaboration_mode.mode` when present — it's the explicit,
 * agent-facing mode. Fall back to the (sandbox, approval) heuristic
 * for older rollouts written before collaboration_mode existed.
 */
export function codexTurnContextToUserMode(
  approvalPolicy: string | undefined,
  sandboxPolicyType: string | undefined,
  collaborationMode?: string | undefined,
): UserMode {
  if (collaborationMode === "plan") return "plan";
  if (sandboxPolicyType === "readOnly" || sandboxPolicyType === "read_only") return "plan";
  switch (approvalPolicy) {
    case "on-request":
    case "on_request":
    case "untrusted":
      return "ask";
    case "on-failure":
    case "on_failure":
      return "acceptEdits";
    default:
      return "bypassPermissions";
  }
}
