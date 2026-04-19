/**
 * Central mapping between our UI-level {@link UserMode} and the
 * native permission knobs each backend expects. One source of truth so
 * the Claude side, Codex side, and history-file readers can't drift.
 */

import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { UserMode } from "@openclawdex/shared";

// ── Claude ───────────────────────────────────────────────────

export const CLAUDE_MODE: Record<UserMode, PermissionMode> = {
  plan: "plan",
  ask: "default",
  acceptEdits: "acceptEdits",
  bypassPermissions: "bypassPermissions",
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

export interface CodexModeOptions {
  approvalPolicy: CodexApprovalPolicy;
  sandbox: CodexSandboxMode;
  sandboxPolicy: CodexSandboxPolicy;
}

/**
 * Codex has two orthogonal axes (`approvalPolicy` + `sandboxPolicy`);
 * we collapse both into one UserMode by picking the combination that
 * most closely matches the UI label. `writableRoots` is rooted at
 * `cwd` when we have one.
 */
export function codexModeOptions(mode: UserMode, cwd: string | undefined): CodexModeOptions {
  const workspaceWrite: CodexSandboxPolicy = {
    type: "workspaceWrite",
    networkAccess: true,
    ...(cwd && { writableRoots: [cwd] }),
  };
  switch (mode) {
    case "plan":
      return {
        approvalPolicy: "never",
        sandbox: "read-only",
        sandboxPolicy: { type: "readOnly" },
      };
    case "ask":
      return {
        approvalPolicy: "on-request",
        sandbox: "workspace-write",
        sandboxPolicy: workspaceWrite,
      };
    case "acceptEdits":
      return {
        approvalPolicy: "on-failure",
        sandbox: "workspace-write",
        sandboxPolicy: workspaceWrite,
      };
    case "bypassPermissions":
      return {
        approvalPolicy: "never",
        sandbox: "workspace-write",
        sandboxPolicy: workspaceWrite,
      };
  }
}

/**
 * Derive {@link UserMode} from a Codex `turn_context` rollout entry.
 * Plan mode is detected by the read-only sandbox; otherwise we dispatch
 * on `approval_policy`.
 */
export function codexTurnContextToUserMode(
  approvalPolicy: string | undefined,
  sandboxPolicyType: string | undefined,
): UserMode {
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
