import { useState } from "react";
import {
  ArrowUp,
  Stop,
  CaretDown,
  ArrowCounterClockwise,
  FileText,
  Paperclip,
  Globe,
  GitBranch,
} from "@phosphor-icons/react";
import type { Thread, Message, FileChange } from "../App";

/* ── File change card ────────────────────────────────────────── */

function FileChangeCard({ changes }: { changes: FileChange[] }) {
  const total = changes.length;
  return (
    <div
      className="rounded-2xl overflow-hidden my-3"
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border-default)",
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-[6px]"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
          {total} file{total > 1 ? "s" : ""} changed
        </span>
        <button
          className="flex items-center gap-1 text-[11px] transition-colors"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.color = "var(--text-primary)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.color = "var(--text-muted)")
          }
        >
          <ArrowCounterClockwise size={12} weight="regular" />
          Undo
        </button>
      </div>
      {changes.map((fc, i) => (
        <div
          key={i}
          className="flex items-center gap-2 px-3 py-[5px] transition-colors"
          style={{ cursor: "default" }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "rgba(255,255,255,0.02)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          <FileText size={13} weight="regular" style={{ color: "var(--text-faint)" }} />
          <span
            className="flex-1 text-[12px] font-mono truncate"
            style={{ color: "var(--text-secondary)" }}
          >
            {fc.path}
          </span>
          <span
            className="text-[11px] font-mono"
            style={{ color: "var(--diff-added)" }}
          >
            +{fc.additions}
          </span>
          <span
            className="text-[11px] font-mono"
            style={{ color: "var(--diff-removed)" }}
          >
            −{fc.deletions}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Collapsed messages ──────────────────────────────────────── */

function CollapsedIndicator({ count }: { count: number }) {
  return (
    <div className="flex items-center justify-center py-3">
      <button
        className="flex items-center gap-1 text-[11px] px-3 py-[4px] rounded-full transition-colors"
        style={{
          color: "var(--text-muted)",
          border: "1px solid var(--border-subtle)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--surface-2)";
          e.currentTarget.style.color = "var(--text-secondary)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "var(--text-muted)";
        }}
      >
        <CaretDown size={12} weight="bold" />
        {count} previous messages
      </button>
    </div>
  );
}

/* ── Message block ───────────────────────────────────────────── */

function MessageBlock({ message }: { message: Message }) {
  if (message.collapsed) {
    return <CollapsedIndicator count={message.collapsed} />;
  }

  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div
        className="rounded-2xl px-5 py-3.5 my-2 text-[13px] leading-[1.65]"
        style={{
          background: "var(--surface-2)",
          color: "var(--text-primary)",
        }}
      >
        {message.content}
      </div>
    );
  }

  return (
    <div className="py-3 px-1">
      <div
        className="text-[13px] leading-[1.7] whitespace-pre-wrap"
        style={{ color: "var(--text-primary)" }}
      >
        {formatContent(message.content)}
      </div>
      {message.fileChanges && message.fileChanges.length > 0 && (
        <FileChangeCard changes={message.fileChanges} />
      )}
    </div>
  );
}

function formatContent(text: string) {
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`")) {
      const inner = part.slice(1, -1);
      const isFileRef = inner.includes("/") || inner.includes("(line");
      return (
        <span
          key={i}
          className="font-mono text-[12px] px-[5px] py-[2px] rounded-lg"
          style={{
            background: "rgba(255,255,255,0.06)",
            color: isFileRef ? "var(--accent)" : "#d4a276",
          }}
        >
          {inner}
        </span>
      );
    }
    return part;
  });
}

/* ── Chat view ───────────────────────────────────────────────── */

interface ChatViewProps {
  thread: Thread | null;
}

export function ChatView({ thread }: ChatViewProps) {
  const [input, setInput] = useState("");

  if (!thread) {
    return (
      <div
        className="flex-1 flex items-center justify-center text-[13px]"
        style={{ color: "var(--text-muted)" }}
      >
        No thread selected
      </div>
    );
  }

  const modelLabel = thread.provider === "claude" ? "Opus 4.6" : "GPT-5.6";
  const providerDot =
    thread.provider === "claude" ? "#d97706" : "#10b981";

  return (
    <div
      className="flex-1 flex flex-col min-w-0"
    >
      {/* Title bar area */}
      <div
        className="h-[38px] shrink-0 flex items-center justify-center"
        style={{
          borderBottom: "1px solid var(--border-subtle)",
          // @ts-expect-error -- webkit
          WebkitAppRegion: "drag",
        }}
      >
        <span
          className="text-[12px] font-medium"
          style={{ color: "var(--text-secondary)" }}
        >
          {thread.name}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {thread.messages.length === 0 ? (
          <div
            className="flex items-center justify-center h-full text-[13px]"
            style={{ color: "var(--text-muted)" }}
          >
            Start a conversation
          </div>
        ) : (
          <div className="max-w-[640px] mx-auto px-5 py-3">
            {thread.messages.map((msg) => (
              <MessageBlock key={msg.id} message={msg} />
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 px-5 pb-4 pt-1">
        <div className="max-w-[640px] mx-auto">
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--border-default)",
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask for follow-up changes"
              rows={1}
              className="w-full bg-transparent text-[13px] px-3 pt-3 pb-2 resize-none outline-none"
              style={{
                color: "var(--text-primary)",
                minHeight: "38px",
                maxHeight: "140px",
              }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = el.scrollHeight + "px";
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) e.preventDefault();
              }}
            />
            {/* Controls */}
            <div className="flex items-center justify-between px-2 pb-2">
              <div className="flex items-center gap-0.5">
                <ControlButton>
                  <span
                    className="w-[6px] h-[6px] rounded-full"
                    style={{ background: providerDot }}
                  />
                  <span>{modelLabel}</span>
                  <CaretDown size={12} weight="bold" />
                </ControlButton>
                <ControlButton>
                  <span>High</span>
                  <CaretDown size={12} weight="bold" />
                </ControlButton>
              </div>
              <div className="flex items-center gap-1">
                <button
                  className="p-1 rounded-lg transition-colors"
                  style={{ color: "var(--text-faint)" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.color = "var(--text-secondary)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.color = "var(--text-faint)")
                  }
                >
                  <Paperclip size={17} weight="regular" />
                </button>
                {thread.status === "running" ? (
                  <button
                    className="p-[6px] rounded-xl"
                    style={{
                      background: "var(--surface-3)",
                      color: "var(--text-primary)",
                    }}
                  >
                    <Stop size={15} weight="fill" />
                  </button>
                ) : (
                  <button
                    className="p-[6px] rounded-xl transition-colors"
                    style={{
                      background: input.trim()
                        ? "var(--accent)"
                        : "var(--surface-3)",
                      color: input.trim() ? "#fff" : "var(--text-faint)",
                    }}
                  >
                    <ArrowUp size={16} weight="bold" />
                  </button>
                )}
              </div>
            </div>
          </div>
          {/* Status info */}
          <div className="flex items-center gap-3 mt-2 px-1">
            <span className="flex items-center gap-1 text-[11px]" style={{ color: "var(--text-faint)" }}>
              <Globe size={11} weight="regular" /> Local
            </span>
            {thread.branch && (
              <span className="flex items-center gap-1 text-[11px]" style={{ color: "var(--text-faint)" }}>
                <GitBranch size={11} weight="regular" /> {thread.branch}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ControlButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      className="flex items-center gap-1.5 px-2.5 py-[4px] rounded-lg text-[13px] transition-colors"
      style={{ color: "var(--text-muted)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--border-subtle)";
        e.currentTarget.style.color = "var(--text-secondary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--text-muted)";
      }}
    >
      {children}
    </button>
  );
}
