import { useState, useRef } from "react";
import { Check, PaperPlaneTilt } from "@phosphor-icons/react";
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
        border: selected ? "2px solid var(--accent)" : "2px solid var(--border-emphasis)",
        background: selected ? "var(--accent)" : "transparent",
      }}
    >
      {selected && (
        <span className="w-[6px] h-[6px] rounded-full" style={{ background: "#fff" }} />
      )}
    </span>
  );
}

function Checkbox({ selected }: { selected: boolean }) {
  return (
    <span
      className="shrink-0 w-[16px] h-[16px] rounded-[4px] flex items-center justify-center transition-colors"
      style={{
        border: selected ? "2px solid var(--accent)" : "2px solid var(--border-emphasis)",
        background: selected ? "var(--accent)" : "transparent",
      }}
    >
      {selected && <Check size={10} weight="bold" color="#fff" />}
    </span>
  );
}

/* ── Claude sparkle icon (small) ──────────────────────────────── */

function ClaudeIconSmall() {
  return (
    <svg viewBox="0 0 248 248" fill="currentColor" className="w-[14px] h-[14px] shrink-0 text-[#D97757]">
      <path d="M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z" />
    </svg>
  );
}

/* ── Main component ───────────────────────────────────────────── */

interface QuestionCardProps {
  toolInput: Record<string, unknown> | undefined;
  /**
   * Submit the user's selections.
   *
   * - `answers` is keyed by the question text (matches the SDK's
   *   `AskUserQuestionOutput.answers` shape so the desktop side can feed
   *   it back as the tool's `updatedInput` via `canUseTool`).
   * - `displayText` is a human-readable rendering for the chat bubble,
   *   composed the same way a user-typed reply would look.
   */
  onSubmit: (payload: { answers: Record<string, string>; displayText: string }) => void;
  /** Whether a user message exists after this tool call (already answered). */
  alreadyAnswered: boolean;
}

export function QuestionCard({ toolInput, onSubmit, alreadyAnswered }: QuestionCardProps) {
  const parsed = AskUserInput.safeParse(toolInput);
  const [answers, setAnswers] = useState<Answers>({});
  const [otherTexts, setOtherTexts] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(alreadyAnswered);
  const otherInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  if (!parsed.success) {
    // Fallback: render as a plain tool indicator
    return (
      <div
        className="flex items-center gap-2 py-1.5 px-1 text-[13px]"
        style={{ color: "var(--text-muted)", fontFamily: "var(--font-code)" }}
      >
        <span>AskUserQuestion</span>
      </div>
    );
  }

  const { questions } = parsed.data;

  function toggleSingle(questionKey: string, label: string) {
    if (submitted) return;
    setAnswers((prev) => ({ ...prev, [questionKey]: label }));
    if (label === OTHER_KEY) {
      // Focus the "Other" input after render
      setTimeout(() => otherInputRefs.current[questionKey]?.focus(), 0);
    }
  }

  function toggleMulti(questionKey: string, label: string) {
    if (submitted) return;
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

  // Check if all questions are answered
  const allAnswered = questions.every((q) => {
    const ans = answers[q.header];
    if (!ans) return false;
    if (q.multiSelect) {
      const arr = ans as string[];
      if (arr.length === 0) return false;
      // If "Other" is selected, must have text
      if (arr.includes(OTHER_KEY) && !(otherTexts[q.header]?.trim())) return false;
    } else {
      if (ans === OTHER_KEY && !(otherTexts[q.header]?.trim())) return false;
    }
    return true;
  });

  function handleSubmit() {
    if (!allAnswered || submitted) return;
    setSubmitted(true);

    // Build two parallel views of the user's choices:
    //   - `answersByQuestion` keyed by the full question text (what the
    //     SDK's AskUserQuestion tool expects in its `answers` field).
    //   - `lines` formatted for the chat bubble, keyed by the short
    //     `header` chip label for readability.
    const answersByQuestion: Record<string, string> = {};
    const lines: string[] = [];

    for (const q of questions) {
      const ans = answers[q.header];
      if (!ans) continue;

      let value: string;
      if (q.multiSelect) {
        const arr = ans as string[];
        const labels = arr.map((a) =>
          a === OTHER_KEY ? otherTexts[q.header] ?? "" : a,
        );
        value = labels.join(", ");
      } else {
        value = ans === OTHER_KEY ? otherTexts[q.header] ?? "" : (ans as string);
      }

      answersByQuestion[q.question] = value;
      lines.push(`**${q.header}**: ${value}`);
    }

    onSubmit({
      answers: answersByQuestion,
      displayText: lines.join("\n"),
    });
  }

  return (
    <div
      className="rounded-2xl overflow-hidden my-3"
      style={{
        background: "var(--surface-1)",
        border: "1px solid var(--border-emphasis)",
        animation: "fadeIn 120ms ease",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <ClaudeIconSmall />
        <span
          className="text-[13px] font-semibold"
          style={{ color: "var(--text-secondary)" }}
        >
          Questions
        </span>
      </div>

      {/* Questions */}
      <div className="px-4 py-3 flex flex-col gap-5">
        {questions.map((q) => {
          const key = q.header;
          return (
            <div key={key} className="flex flex-col gap-2.5">
              {/* Header chip + question text */}
              <div className="flex flex-col gap-1.5">
                <span
                  className="text-[11px] font-semibold uppercase tracking-wider px-2 py-[2px] rounded-md w-fit"
                  style={{
                    color: "var(--accent)",
                    background: "rgba(51, 156, 255, 0.10)",
                  }}
                >
                  {q.header}
                </span>
                <span
                  className="text-[14px] font-medium leading-snug"
                  style={{ color: "var(--text-primary)" }}
                >
                  {q.question}
                </span>
              </div>

              {/* Options */}
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
                      disabled={submitted}
                      className="w-full flex items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-all"
                      style={{
                        background: selected
                          ? "rgba(51, 156, 255, 0.08)"
                          : "var(--surface-2)",
                        border: selected
                          ? "1px solid rgba(51, 156, 255, 0.3)"
                          : "1px solid var(--border-default)",
                        cursor: submitted ? "default" : "pointer",
                        opacity: submitted && !selected ? 0.4 : 1,
                      }}
                      onMouseEnter={(e) => {
                        if (!submitted) {
                          e.currentTarget.style.borderColor = selected
                            ? "rgba(51, 156, 255, 0.5)"
                            : "var(--border-emphasis)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!submitted) {
                          e.currentTarget.style.borderColor = selected
                            ? "rgba(51, 156, 255, 0.3)"
                            : "var(--border-default)";
                        }
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

                {/* Other option */}
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
                        disabled={submitted}
                        className="w-full flex items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-all"
                        style={{
                          background: otherSelected
                            ? "rgba(51, 156, 255, 0.08)"
                            : "var(--surface-2)",
                          border: otherSelected
                            ? "1px solid rgba(51, 156, 255, 0.3)"
                            : "1px solid var(--border-default)",
                          cursor: submitted ? "default" : "pointer",
                          opacity: submitted && !otherSelected ? 0.4 : 1,
                        }}
                        onMouseEnter={(e) => {
                          if (!submitted) {
                            e.currentTarget.style.borderColor = otherSelected
                              ? "rgba(51, 156, 255, 0.5)"
                              : "var(--border-emphasis)";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!submitted) {
                            e.currentTarget.style.borderColor = otherSelected
                              ? "rgba(51, 156, 255, 0.3)"
                              : "var(--border-default)";
                          }
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
                      {otherSelected && !submitted && (
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
                            background: "var(--surface-2)",
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
        })}
      </div>

      {/* Submit button */}
      {!submitted && (
        <div
          className="flex justify-end px-4 py-3"
          style={{ borderTop: "1px solid var(--border-subtle)" }}
        >
          <button
            onClick={handleSubmit}
            disabled={!allAnswered}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-[13px] font-semibold transition-all"
            style={{
              background: allAnswered ? "var(--accent)" : "var(--surface-3)",
              color: allAnswered ? "#fff" : "var(--text-faint)",
              cursor: allAnswered ? "pointer" : "default",
            }}
            onMouseEnter={(e) => {
              if (allAnswered) e.currentTarget.style.background = "#4AA8FF";
            }}
            onMouseLeave={(e) => {
              if (allAnswered) e.currentTarget.style.background = "var(--accent)";
            }}
          >
            Submit answers
            <PaperPlaneTilt size={14} weight="bold" />
          </button>
        </div>
      )}

      {/* Submitted confirmation */}
      {submitted && !alreadyAnswered && (
        <div
          className="flex items-center gap-2 px-4 py-2.5"
          style={{
            borderTop: "1px solid var(--border-subtle)",
            color: "var(--diff-added)",
          }}
        >
          <Check size={14} weight="bold" />
          <span className="text-[12px] font-medium">Answers submitted</span>
        </div>
      )}
    </div>
  );
}
