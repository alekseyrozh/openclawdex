import { useContext, useEffect } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { MarkdownContent, OpenFileContext } from "./ChatView";
import { ScrollArea } from "./ScrollArea";

/**
 * The model called `ExitPlanMode` while the session was in plan mode.
 * The CLI side of native Claude Code would pop a dialog asking the
 * user to approve the proposed plan; in our wrapper we render this
 * card inline in the chat transcript.
 *
 * Approving resolves the paused `canUseTool` Promise with `allow` —
 * the SDK runs ExitPlanMode, we flip session mode off plan, and the
 * model continues. Rejecting resolves with `deny` — the agent stays
 * in plan mode and sees a clear rejection message in the tool_result.
 *
 * Keyboard shortcuts (window-level so they work whether focus is in
 * the composer textarea or anywhere else):
 *   - ESC          → Dismiss
 *   - ⌘/Ctrl+Enter → Allow
 *
 * Long plans get a bounded scroll region instead of pushing the
 * dismiss/allow buttons off-screen — the decision needs to be visible.
 * `planFilePath` doubles as an "Open in editor" button so the user
 * can read the full plan in their tool of choice if the inline
 * preview isn't enough.
 */
export function PlanApprovalCard({
  plan,
  planFilePath,
  onApprove,
  onReject,
}: {
  plan: string;
  planFilePath?: string;
  onApprove: () => void;
  onReject: () => void;
}) {
  const ctx = useContext(OpenFileContext);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onReject();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onApprove();
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onApprove, onReject]);

  const trimmed = plan.trim();
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border-default)",
      }}
    >
      <div className="px-4 pt-3.5 pb-3 flex flex-col gap-2.5 min-w-0">
        <div className="flex items-baseline justify-between gap-3 min-w-0">
          <div
            className="text-[13px] font-semibold leading-snug"
            style={{ color: "var(--text-primary)" }}
          >
            Apply this plan?
          </div>
          {planFilePath && ctx ? (
            <button
              type="button"
              onClick={() => ctx.open(planFilePath)}
              title={`Open in ${ctx.editorLabel}: ${planFilePath}`}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg font-mono text-[11.5px] min-w-0 transition-colors cursor-pointer"
              style={{
                color: "var(--text-secondary)",
                background: "rgba(255,255,255,0.05)",
                border: "1px solid var(--border-subtle)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.09)";
                e.currentTarget.style.color = "var(--text-primary)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.05)";
                e.currentTarget.style.color = "var(--text-secondary)";
              }}
            >
              <ArrowSquareOut size={12} weight="bold" className="shrink-0" />
              <span className="truncate">{planFilePath}</span>
            </button>
          ) : (
            planFilePath && (
              <span
                className="font-mono text-[11px] truncate min-w-0"
                style={{ color: "var(--text-faint)" }}
                title={planFilePath}
              >
                {planFilePath}
              </span>
            )
          )}
        </div>
        <div
          className="rounded-lg overflow-hidden"
          style={{ background: "var(--surface-0)" }}
        >
          <ScrollArea maxHeight="min(50vh, 420px)">
            <div
              className="px-5 py-4 text-[13px] leading-snug"
              style={{ color: "var(--text-secondary)" }}
            >
              {trimmed ? (
                <MarkdownContent text={trimmed} />
              ) : (
                <em style={{ color: "var(--text-muted)" }}>
                  The model did not include a written plan — approving will simply exit plan mode.
                </em>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      <div className="flex items-center justify-between px-3 pb-2">
        <button
          onClick={onReject}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = "var(--text-primary)";
            e.currentTarget.style.background = "var(--surface-3)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = "var(--text-muted)";
            e.currentTarget.style.background = "transparent";
          }}
        >
          Dismiss
          <Kbd>ESC</Kbd>
        </button>
        <button
          onClick={onApprove}
          className="flex items-center gap-2 px-4 py-1.5 rounded-full text-[12.5px] font-semibold transition-all"
          style={{
            background: "var(--text-primary)",
            color: "var(--surface-0)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.85)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--text-primary)";
          }}
        >
          Allow
          <Kbd dark>⌘↵</Kbd>
        </button>
      </div>
    </div>
  );
}

function Kbd({ children, dark = false }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <span
      className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-[2px] rounded-md"
      style={
        dark
          ? { background: "rgba(0,0,0,0.12)", color: "rgba(0,0,0,0.55)" }
          : { background: "var(--surface-3)", color: "var(--text-faint)" }
      }
    >
      {children}
    </span>
  );
}
