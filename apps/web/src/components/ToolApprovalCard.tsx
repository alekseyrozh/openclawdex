import { useEffect } from "react";

/**
 * Approval prompt for a single tool call. Renders as a banner ABOVE
 * the regular chat composer while the agent is paused on a
 * `tool_approval` pending request — the user can either click the
 * Deny / Allow buttons here, or type a free-form message into the
 * composer below and send it (which the parent treats as a deny with
 * that text as the feedback note).
 *
 * Keyboard shortcuts (window-level so they work whether focus is in
 * the composer textarea or anywhere else in the chat):
 *   - ESC          → Deny
 *   - ⌘/Ctrl+Enter → Allow
 *
 * We deliberately show only WHAT will run (command for Bash, file
 * path for Edit, etc.) — not a diff. The full proposed change is
 * already visible in the streamed tool_use card above.
 *
 * Each call prompts independently — users who want a blanket bypass
 * switch the mode dropdown to "Auto-accept edits" or "Bypass
 * permissions".
 */
export function ToolApprovalCard({
  toolName,
  toolInput,
  onApprove,
  onReject,
}: {
  toolName: string;
  toolInput: Record<string, unknown>;
  onApprove: () => void;
  onReject: () => void;
}) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      // Ignore if focus is in an editable input that needs the key —
      // EXCEPT for our two intentional shortcuts (ESC and ⌘/Ctrl+Enter).
      // Plain Enter inside the chat textarea is handled by the
      // composer (it routes a typed message back as a deny note), so
      // we never claim it here.
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

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border-default)",
      }}
    >
      <div className="px-4 pt-3.5 pb-3 flex flex-col gap-2.5">
        <div
          className="text-[13px] font-semibold leading-snug"
          style={{ color: "var(--text-primary)" }}
        >
          {subjectLabel(toolName)}
        </div>
        <Preview toolName={toolName} toolInput={toolInput} />
      </div>

      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
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
          Deny
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

function subjectLabel(toolName: string): string {
  switch (toolName) {
    case "Bash":
      return "Run this command?";
    case "Edit":
      return "Edit this file?";
    case "Write":
      return "Write this file?";
    case "NotebookEdit":
      return "Edit this notebook cell?";
    case "Agent":
    case "Task":
      return "Spawn this subagent?";
    default:
      return `Run ${toolName}?`;
  }
}

function Preview({
  toolName,
  toolInput,
}: {
  toolName: string;
  toolInput: Record<string, unknown>;
}) {
  switch (toolName) {
    case "Bash": {
      const command = typeof toolInput.command === "string" ? toolInput.command : "";
      return <CodeBlock text={command} />;
    }
    case "Edit":
    case "Write":
    case "NotebookEdit": {
      const filePath = typeof toolInput.file_path === "string"
        ? toolInput.file_path
        : typeof toolInput.notebook_path === "string"
          ? toolInput.notebook_path
          : "";
      return <CodeBlock text={filePath} />;
    }
    case "Agent":
    case "Task": {
      const description = typeof toolInput.description === "string" ? toolInput.description : "";
      return <CodeBlock text={description || "(no description provided)"} />;
    }
    default: {
      const summary = JSON.stringify(toolInput);
      return <CodeBlock text={summary.length > 160 ? summary.slice(0, 160) + "…" : summary} />;
    }
  }
}

function CodeBlock({ text }: { text: string }) {
  return (
    <pre
      className="font-mono text-[12.5px] leading-relaxed rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre-wrap break-words"
      style={{
        background: "var(--surface-0)",
        color: "var(--text-secondary)",
        margin: 0,
      }}
    >
      {text}
    </pre>
  );
}
