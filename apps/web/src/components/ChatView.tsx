import { useState, useRef, useEffect } from "react";
import {
  ArrowUp,
  Stop,
  CaretDown,
  Check,
  ArrowCounterClockwise,
  FileText,
  Monitor,
  GitBranch,
} from "@phosphor-icons/react";
import type { Thread, Message, FileChange } from "../App";

/* ── Claude sparkle icon ────────────────────────────────────── */

function ClaudeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 248 248" fill="currentColor" className={className}>
      <path d="M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z" />
    </svg>
  );
}

/* ── Model definitions ──────────────────────────────────────── */

interface ModelDef {
  id: string;
  label: string;
  subtitle: string;
}

const CLAUDE_MODELS: ModelDef[] = [
  { id: "opus", label: "Claude Opus 4.6", subtitle: "Most capable" },
  { id: "sonnet", label: "Claude Sonnet 4.6", subtitle: "Fast & capable" },
  { id: "haiku", label: "Claude Haiku 4.5", subtitle: "Fastest" },
];

/* ── Effort levels ──────────────────────────────────────────── */

interface EffortDef {
  id: string;
  label: string;
  subtitle: string;
}

const EFFORT_LEVELS: EffortDef[] = [
  { id: "max", label: "Max", subtitle: "Extended thinking, highest quality" },
  { id: "high", label: "High", subtitle: "Thorough reasoning" },
  { id: "medium", label: "Medium", subtitle: "Balanced speed and quality" },
  { id: "low", label: "Low", subtitle: "Fast, minimal reasoning" },
];

/* ── File change card ────────────────────────────────────────── */

function FileChangeCard({ changes }: { changes: FileChange[] }) {
  const total = changes.length;
  return (
    <div
      className="rounded-2xl overflow-hidden my-3"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border-emphasis)",
      }}
    >
      <div
        className="flex items-center justify-between px-3 py-[6px]"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <span className="text-[13px] font-medium" style={{ color: "var(--text-secondary)" }}>
          {total} file{total > 1 ? "s" : ""} changed
        </span>
        <button
          className="flex items-center gap-1 text-[13px] font-medium transition-colors"
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
          className="flex items-center gap-2 px-3 py-[7px] transition-colors"
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
            className="flex-1 text-[13px] font-mono font-medium truncate"
            style={{ color: "var(--text-secondary)" }}
          >
            {fc.path}
          </span>
          <span
            className="text-[13px] font-mono font-medium"
            style={{ color: "var(--diff-added)" }}
          >
            +{fc.additions}
          </span>
          <span
            className="text-[13px] font-mono font-medium"
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
        className="flex items-center gap-1 text-[13px] font-medium px-3 py-[4px] rounded-full transition-colors"
        style={{
          color: "rgba(255, 255, 255, 0.60)",
          border: "1px solid var(--border-default)",
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
        className="rounded-2xl px-5 py-3.5 my-3 text-[14px] leading-[1.6] font-medium ml-auto w-fit max-w-[85%]"
        style={{
          background: "var(--surface-3)",
          color: "var(--text-primary)",
        }}
      >
        {message.content}
      </div>
    );
  }

  return (
    <div className="py-4 px-1">
      <div
        className="text-[14px] leading-[1.65] whitespace-pre-wrap font-medium"
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
      if (isFileRef) {
        return (
          <span
            key={i}
            className="font-mono text-[12.5px] font-semibold"
            style={{ color: "#6DC6FF" }}
          >
            {inner}
          </span>
        );
      }
      return (
        <span
          key={i}
          className="font-mono text-[12.5px] font-medium px-[5px] py-[2px] rounded-md"
          style={{
            background: "rgba(255,255,255,0.07)",
            color: "var(--text-primary)",
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
  const [selectedModel, setSelectedModel] = useState(CLAUDE_MODELS[0]);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const [selectedEffort, setSelectedEffort] = useState(EFFORT_LEVELS[1]); // default "high"
  const [effortDropdownOpen, setEffortDropdownOpen] = useState(false);
  const effortDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!modelDropdownOpen && !effortDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (modelDropdownOpen && modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
      if (effortDropdownOpen && effortDropdownRef.current && !effortDropdownRef.current.contains(e.target as Node)) {
        setEffortDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [modelDropdownOpen, effortDropdownOpen]);

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

  const isClaude = thread.provider === "claude";
  const modelLabel = isClaude ? selectedModel.label : "GPT-5.6";

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
          <div className="max-w-[720px] mx-auto px-5 py-3">
            {thread.messages.map((msg) => (
              <MessageBlock key={msg.id} message={msg} />
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 px-5 pb-4 pt-1">
        <div className="max-w-[720px] mx-auto">
          <div
            className="rounded-2xl"
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border-default)",
            }}
          >
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask for follow-up changes"
              rows={1}
              className="w-full bg-transparent text-[14px] px-4 pt-3 pb-1 resize-none outline-none placeholder:text-[var(--text-faint)]"
              style={{
                color: "var(--text-primary)",
                minHeight: "36px",
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
              <div className="flex items-center gap-0">
<div className="relative" ref={modelDropdownRef}>
                  <ControlButton onClick={() => isClaude && setModelDropdownOpen((v) => !v)}>
                    <ClaudeIcon className="w-[14px] h-[14px] shrink-0 text-[#D97757]" />
                    <span>{modelLabel}</span>
                    <CaretDown size={10} weight="bold" />
                  </ControlButton>
                  {modelDropdownOpen && isClaude && (
                    <ModelDropdown
                      models={CLAUDE_MODELS}
                      selected={selectedModel}
                      onSelect={(m) => {
                        setSelectedModel(m);
                        setModelDropdownOpen(false);
                      }}
                    />
                  )}
                </div>
                <div className="relative" ref={effortDropdownRef}>
                  <ControlButton onClick={() => setEffortDropdownOpen((v) => !v)}>
                    <span>{selectedEffort.label}</span>
                    <CaretDown size={10} weight="bold" />
                  </ControlButton>
                  {effortDropdownOpen && (
                    <EffortDropdown
                      levels={EFFORT_LEVELS}
                      selected={selectedEffort}
                      onSelect={(e) => {
                        setSelectedEffort(e);
                        setEffortDropdownOpen(false);
                      }}
                    />
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {thread.status === "running" ? (
                  <button
                    className="w-[30px] h-[30px] flex items-center justify-center rounded-full"
                    style={{
                      background: "var(--text-primary)",
                    }}
                  >
                    <Stop size={14} weight="fill" style={{ color: "var(--surface-0)" }} />
                  </button>
                ) : (
                  <button
                    className="w-[30px] h-[30px] flex items-center justify-center rounded-full transition-colors"
                    style={{
                      background: input.trim()
                        ? "var(--text-primary)"
                        : "var(--surface-3)",
                      color: input.trim() ? "var(--surface-0)" : "var(--text-faint)",
                    }}
                  >
                    <ArrowUp size={16} weight="bold" />
                  </button>
                )}
              </div>
            </div>
          </div>
          {/* Status info */}
          <div className="flex items-center gap-1 mt-2 px-0.5">
            <StatusButton>
              <Monitor size={14} weight="regular" />
              <span>Local</span>
              <CaretDown size={10} weight="bold" />
            </StatusButton>
            {thread.branch && (
              <StatusButton>
                <GitBranch size={14} weight="regular" />
                <span>{thread.branch}</span>
                <CaretDown size={10} weight="bold" />
              </StatusButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusButton({ children }: { children: React.ReactNode }) {
  return (
    <button
      className="flex items-center gap-1.5 px-2 py-[3px] rounded-lg text-[12px] font-medium transition-colors"
      style={{ color: "var(--text-muted)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--text-secondary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--text-muted)";
      }}
    >
      {children}
    </button>
  );
}

function ControlButton({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-2 py-[5px] rounded-xl text-[13px] transition-colors"
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

/* ── Model dropdown ─────────────────────────────────────────── */

function ModelDropdown({
  models,
  selected,
  onSelect,
}: {
  models: ModelDef[];
  selected: ModelDef;
  onSelect: (m: ModelDef) => void;
}) {
  return (
    <div
      className="absolute bottom-full left-0 mb-2 rounded-2xl p-1.5 min-w-[260px] z-50 flex flex-col gap-[2px]"
      style={{
        background: "var(--surface-3)",
        border: "1px solid var(--border-emphasis)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      {models.map((m) => {
        const isSelected = m.id === selected.id;
        return (
          <button
            key={m.id}
            onClick={() => onSelect(m)}
            className="w-full flex items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors"
            style={{
              background: isSelected ? "rgba(255,255,255,0.06)" : "transparent",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = isSelected ? "rgba(255,255,255,0.06)" : "transparent")}
          >
            <ClaudeIcon className="w-[20px] h-[20px] shrink-0 mt-0.5 text-[#D97757]" />
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <span
                className="text-[13px] font-medium leading-tight"
                style={{ color: "var(--text-primary)" }}
              >
                {m.label}
              </span>
              <span
                className="text-[11px] leading-tight"
                style={{ color: "var(--text-muted)" }}
              >
                {m.subtitle}
              </span>
            </div>
            {isSelected && (
              <Check size={14} weight="bold" className="shrink-0 mt-0.5" style={{ color: "var(--text-primary)" }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── Effort dropdown ───────────────────────────────────────── */

function EffortDropdown({
  levels,
  selected,
  onSelect,
}: {
  levels: EffortDef[];
  selected: EffortDef;
  onSelect: (e: EffortDef) => void;
}) {
  return (
    <div
      className="absolute bottom-full left-0 mb-2 rounded-2xl p-1.5 min-w-[280px] z-50 flex flex-col gap-[2px]"
      style={{
        background: "var(--surface-3)",
        border: "1px solid var(--border-emphasis)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
      }}
    >
      {levels.map((lvl) => {
        const isSelected = lvl.id === selected.id;
        return (
          <button
            key={lvl.id}
            onClick={() => onSelect(lvl)}
            className="w-full flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors"
            style={{
              background: isSelected ? "rgba(255,255,255,0.06)" : "transparent",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = isSelected ? "rgba(255,255,255,0.06)" : "transparent")}
          >
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <span
                className="text-[13px] font-medium leading-tight"
                style={{ color: "var(--text-primary)" }}
              >
                {lvl.label}
              </span>
              <span
                className="text-[11px] leading-tight"
                style={{ color: "var(--text-muted)" }}
              >
                {lvl.subtitle}
              </span>
            </div>
            {isSelected && (
              <Check size={14} weight="bold" className="shrink-0" style={{ color: "var(--text-primary)" }} />
            )}
          </button>
        );
      })}
    </div>
  );
}
