import { useEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight, Check } from "@phosphor-icons/react";
import { AskUserInput } from "@openclawdex/shared";

/* ── Types ────────────────────────────────────────────────────── */

type SingleAnswer = string; // label or "__other__"
type MultiAnswer = string[]; // labels + possibly "__other__"
type Answers = Record<string, SingleAnswer | MultiAnswer>;

const OTHER_KEY = "__other__";

/* ── Radio / checkbox visuals ─────────────────────────────────── */

function Radio({ selected }: { selected: boolean }) {
  return (
    <span
      className="shrink-0 w-[16px] h-[16px] rounded-full flex items-center justify-center transition-colors"
      style={{
        border: selected
          ? "2px solid var(--text-primary)"
          : "2px solid var(--border-emphasis)",
        background: selected ? "var(--text-primary)" : "transparent",
      }}
    >
      {selected && (
        <span
          className="w-[6px] h-[6px] rounded-full"
          style={{ background: "var(--surface-0)" }}
        />
      )}
    </span>
  );
}

function Checkbox({ selected }: { selected: boolean }) {
  return (
    <span
      className="shrink-0 w-[16px] h-[16px] rounded-[4px] flex items-center justify-center transition-colors"
      style={{
        border: selected
          ? "2px solid var(--text-primary)"
          : "2px solid var(--border-emphasis)",
        background: selected ? "var(--text-primary)" : "transparent",
      }}
    >
      {selected && <Check size={10} weight="bold" color="var(--surface-0)" />}
    </span>
  );
}

/* ── Paginator arrow button ───────────────────────────────────── */

function PaginatorButton({
  onClick,
  disabled,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  // Naked icon by default: no background, no border. Hover reveals a
  // subtle rounded highlight so the target feels tactile without ever
  // looking like a hard-edged button in rest state. Styling lives in
  // index.css (`.paginator-btn`) so :hover tracks reliably through
  // click/blur — JS mouse handlers were leaving a stuck bg after click.
  // `onMouseDown` preventDefault keeps focus off the button, so there's
  // no lingering focus ring either.
  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="paginator-btn w-7 h-7 flex items-center justify-center rounded-full transition-colors"
      style={{ cursor: disabled ? "default" : "pointer" }}
    >
      {children}
    </button>
  );
}

/* ── Main component ───────────────────────────────────────────── */

export interface QuestionnaireFormProps {
  toolInput: Record<string, unknown> | undefined;
  /**
   * Submit the user's selections.
   *
   * - `answers` is keyed by the full question text (matches the SDK's
   *   `AskUserQuestionOutput.answers` shape so the desktop side can feed
   *   it back as the tool's `updatedInput` via `canUseTool`).
   * - `displayText` is a plaintext fallback (used when older messages are
   *   rehydrated without structured metadata).
   * - `answerChips` is the structured header/value pair list used by the
   *   renderer to show the chip-style user bubble.
   */
  onSubmit: (payload: {
    answers: Record<string, string>;
    displayText: string;
    questionAnswers: Array<{ question: string; value: string }>;
  }) => void;
  /** Dismiss the questionnaire. ESC in the form also triggers this. */
  onCancel: () => void;
}

/**
 * Renders the AskUserQuestion options as a form inside the composer. No
 * outer card chrome — the composer owns the surrounding surface. ESC
 * dismisses, Enter on the "Other" input submits when everything is
 * answered.
 */
export function QuestionnaireForm({
  toolInput,
  onSubmit,
  onCancel,
}: QuestionnaireFormProps) {
  const parsed = AskUserInput.safeParse(toolInput);
  const [answers, setAnswers] = useState<Answers>({});
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const otherInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const rootRef = useRef<HTMLDivElement>(null);

  // Make the form focusable so ESC fires even before the user clicks
  // into any control. Focus on mount, let children intercept as needed.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  if (!parsed.success) {
    return (
      <div
        className="flex items-center justify-between px-4 py-3 text-[13px]"
        style={{ color: "var(--text-muted)", fontFamily: "var(--font-code)" }}
      >
        <span>Malformed AskUserQuestion input</span>
        <button
          onClick={onCancel}
          className="text-[12px] font-medium px-2 py-1 rounded-md"
          style={{ color: "var(--text-secondary)" }}
        >
          Dismiss
        </button>
      </div>
    );
  }

  const { questions } = parsed.data;
  const totalQuestions = questions.length;
  const canPaginate = totalQuestions > 1;
  const safeIndex = Math.min(currentIndex, totalQuestions - 1);
  const currentQuestion = questions[safeIndex];

  function isQuestionAnswered(q: (typeof questions)[number]): boolean {
    const ans = answers[q.header];
    if (!ans) return false;
    if (q.multiSelect) {
      const arr = ans as string[];
      if (arr.length === 0) return false;
      if (arr.includes(OTHER_KEY) && !otherTexts[q.header]?.trim()) return false;
    } else {
      if (ans === OTHER_KEY && !otherTexts[q.header]?.trim()) return false;
    }
    return true;
  }

  function toggleSingle(questionKey: string, label: string) {
    setAnswers((prev) => ({ ...prev, [questionKey]: label }));
    if (label === OTHER_KEY) {
      setTimeout(() => otherInputRefs.current[questionKey]?.focus(), 0);
      return;
    }
    // Auto-advance to the next question on single-select picks (but not
    // on "Other", which needs a free-text follow-up). Advance in the
    // same render as the answer update so React commits both together —
    // a delay here causes the Next button to flash enabled before the
    // index changes, which reads as a glitch.
    if (canPaginate && safeIndex < totalQuestions - 1) {
      setCurrentIndex((i) => Math.min(i + 1, totalQuestions - 1));
    }
  }

  function toggleMulti(questionKey: string, label: string) {
    setAnswers((prev) => {
      const current = (prev[questionKey] as string[] | undefined) ?? [];
      const next = current.includes(label)
        ? current.filter((l) => l !== label)
        : [...current, label];
      return { ...prev, [questionKey]: next };
    });
    if (label === OTHER_KEY) {
      setTimeout(() => otherInputRefs.current[questionKey]?.focus(), 0);
    }
  }

  function isSelected(questionKey: string, label: string, multiSelect: boolean): boolean {
    const ans = answers[questionKey];
    if (!ans) return false;
    if (multiSelect) return (ans as string[]).includes(label);
    return ans === label;
  }

  const allAnswered = questions.every(isQuestionAnswered);
  const currentAnswered = isQuestionAnswered(currentQuestion);

  function goPrev() {
    setCurrentIndex((i) => Math.max(i - 1, 0));
  }
  function goNext() {
    setCurrentIndex((i) => Math.min(i + 1, totalQuestions - 1));
  }

  function handleSubmit() {
    if (!allAnswered) return;

    const answersByQuestion: Record<string, string> = {};
    const lines: string[] = [];
    const questionAnswers: Array<{ question: string; value: string }> = [];

    for (const q of questions) {
      const ans = answers[q.header];
      if (!ans) continue;

      let value: string;
      if (q.multiSelect) {
        const arr = ans as string[];
        value = arr
          .map((a) => (a === OTHER_KEY ? otherTexts[q.header] ?? "" : a))
          .join(", ");
      } else {
        value = ans === OTHER_KEY ? otherTexts[q.header] ?? "" : (ans as string);
      }

      answersByQuestion[q.question] = value;
      lines.push(`**${q.header}**: ${value}`);
      questionAnswers.push({ question: q.question, value });
    }

    onSubmit({
      answers: answersByQuestion,
      displayText: lines.join("\n"),
      questionAnswers,
    });
  }

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
          return;
        }
        // ⌘/Ctrl+Enter mirrors the primary action — Submit on the last
        // question, Next otherwise. Plain Enter inside the "Other" text
        // input still submits via the input's own handler (when all
        // questions are answered) so users in flow don't need a chord.
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          const isLast = safeIndex === totalQuestions - 1;
          if (isLast && allAnswered) {
            e.preventDefault();
            handleSubmit();
          } else if (!isLast && currentAnswered) {
            e.preventDefault();
            goNext();
          }
          return;
        }
        // Arrow keys navigate between questions — but let text inputs
        // handle them for cursor movement (the "Other" free-text field).
        const inTextInput =
          e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement;
        if (!inTextInput && canPaginate) {
          if (e.key === "ArrowRight" && safeIndex < totalQuestions - 1) {
            e.preventDefault();
            goNext();
          } else if (e.key === "ArrowLeft" && safeIndex > 0) {
            e.preventDefault();
            goPrev();
          }
        }
      }}
      className="flex flex-col outline-none"
      style={{ animation: "fadeIn 120ms ease" }}
    >
      {/* Pagination header — only shown when there's more than one
          question. Matches the "N of M" counter pattern in the
          reference design. */}
      {canPaginate && (
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <span
            className="text-[12px] font-medium"
            style={{ color: "var(--text-muted)" }}
          >
            Question {safeIndex + 1} of {totalQuestions}
          </span>
          <div className="flex items-center gap-1">
            <PaginatorButton
              onClick={goPrev}
              disabled={safeIndex === 0}
              ariaLabel="Previous question"
            >
              <CaretLeft size={14} weight="bold" />
            </PaginatorButton>
            <PaginatorButton
              onClick={goNext}
              disabled={safeIndex === totalQuestions - 1 || !currentAnswered}
              ariaLabel="Next question"
            >
              <CaretRight size={14} weight="bold" />
            </PaginatorButton>
          </div>
        </div>
      )}

      {/* Current question.
          NOTE: we can't use the JS-driven `ScrollArea` here — that
          component relies on `absolute inset-0` internals that require
          a parent with a flex-given height, and the composer is
          content-sized. `thin-scrollbar` reuses the same thumb color
          and radius so the two styles read as the same scroller. */}
      <div
        className="px-4 py-3.5 flex flex-col gap-5 overflow-y-auto thin-scrollbar"
        style={{ maxHeight: "60vh" }}
      >
        {(() => {
          const q = currentQuestion;
          const key = q.header;
          return (
            <div key={key} className="flex flex-col gap-2.5">
              <span
                className="text-[14px] font-medium leading-snug"
                style={{ color: "var(--text-primary)" }}
              >
                {q.question}
              </span>

              <div className="flex flex-col gap-1.5">
                {q.options.map((opt) => {
                  const selected = isSelected(key, opt.label, q.multiSelect);
                  return (
                    <button
                      key={opt.label}
                      onClick={() =>
                        q.multiSelect
                          ? toggleMulti(key, opt.label)
                          : toggleSingle(key, opt.label)
                      }
                      className="w-full flex items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-all cursor-pointer"
                      style={{
                        background: "var(--surface-3)",
                        border: selected
                          ? "1px solid var(--border-emphasis)"
                          : "1px solid var(--border-default)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor =
                          "var(--border-emphasis)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = selected
                          ? "var(--border-emphasis)"
                          : "var(--border-default)";
                      }}
                    >
                      <div className="mt-0.5">
                        {q.multiSelect ? (
                          <Checkbox selected={selected} />
                        ) : (
                          <Radio selected={selected} />
                        )}
                      </div>
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <span
                          className="text-[13px] font-medium leading-tight"
                          style={{ color: "var(--text-primary)" }}
                        >
                          {opt.label}
                        </span>
                        <span
                          className="text-[12px] leading-snug"
                          style={{ color: "var(--text-muted)" }}
                        >
                          {opt.description}
                        </span>
                      </div>
                    </button>
                  );
                })}

                {(() => {
                  const otherSelected = isSelected(key, OTHER_KEY, q.multiSelect);
                  return (
                    <div className="flex flex-col gap-1.5">
                      <button
                        onClick={() =>
                          q.multiSelect
                            ? toggleMulti(key, OTHER_KEY)
                            : toggleSingle(key, OTHER_KEY)
                        }
                        className="w-full flex items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-all cursor-pointer"
                        style={{
                          background: "var(--surface-3)",
                          border: otherSelected
                            ? "1px solid var(--border-emphasis)"
                            : "1px solid var(--border-default)",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor =
                            "var(--border-emphasis)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = otherSelected
                            ? "var(--border-emphasis)"
                            : "var(--border-default)";
                        }}
                      >
                        <div className="mt-0.5">
                          {q.multiSelect ? (
                            <Checkbox selected={otherSelected} />
                          ) : (
                            <Radio selected={otherSelected} />
                          )}
                        </div>
                        <span
                          className="text-[13px] font-medium leading-tight"
                          style={{ color: "var(--text-secondary)" }}
                        >
                          Other
                        </span>
                      </button>
                      {otherSelected && (
                        <input
                          ref={(el) => { otherInputRefs.current[key] = el; }}
                          type="text"
                          value={otherTexts[key] ?? ""}
                          onChange={(e) =>
                            setOtherTexts((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && allAnswered) {
                              e.preventDefault();
                              handleSubmit();
                            }
                          }}
                          placeholder="Type your answer..."
                          className="w-full rounded-xl px-3 py-2 text-[13px] font-medium outline-none transition-colors"
                          style={{
                            background: "var(--surface-3)",
                            border: "1px solid var(--border-emphasis)",
                            color: "var(--text-primary)",
                            marginLeft: "28px",
                            width: "calc(100% - 28px)",
                          }}
                        />
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Action row */}
      <div
        className="flex items-center justify-between px-3 py-2.5"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-medium transition-colors"
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
          <span
            className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-[2px] rounded-md"
            style={{
              background: "var(--surface-3)",
              color: "var(--text-faint)",
            }}
          >
            ESC
          </span>
        </button>
        {(() => {
          // On the last question the primary action submits everything;
          // otherwise it advances to the next unanswered question. Next
          // only needs the *current* question answered; Submit needs all.
          const isLast = safeIndex === totalQuestions - 1;
          const enabled = isLast ? allAnswered : currentAnswered;
          const label = isLast ? "Submit" : "Next";
          const handleClick = isLast ? handleSubmit : goNext;
          return (
            <button
              onClick={handleClick}
              disabled={!enabled}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-semibold transition-all"
              style={{
                background: enabled ? "var(--text-primary)" : "var(--surface-3)",
                color: enabled ? "var(--surface-0)" : "var(--text-faint)",
                cursor: enabled ? "pointer" : "default",
              }}
              onMouseEnter={(e) => {
                if (enabled) e.currentTarget.style.background = "rgba(255,255,255,0.85)";
              }}
              onMouseLeave={(e) => {
                if (enabled) e.currentTarget.style.background = "var(--text-primary)";
              }}
            >
              {label}
              <span
                className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-[2px] rounded-md"
                style={
                  enabled
                    ? { background: "rgba(0,0,0,0.12)", color: "rgba(0,0,0,0.55)" }
                    : { background: "var(--surface-4)", color: "var(--text-faint)" }
                }
              >
                ⌘↵
              </span>
            </button>
          );
        })()}
      </div>
    </div>
  );
}
