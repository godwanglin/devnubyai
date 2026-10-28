"use client";

import React, { useState } from "react";
import { HelpCircle, Check, X, Sparkles, Lightbulb } from "lucide-react";
import { cn } from "@/lib/cn";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import type { InteractiveQuizInput } from "@/lib/tools/interactive-quiz";

interface NormalizedOption {
  id: string;
  text: string;
  isCorrect?: boolean;
  explanation?: string;
}

interface InteractiveQuizWidgetProps {
  data: InteractiveQuizInput | Record<string, unknown>;
  toolCallId?: string;
  messageId?: string;
  chatId?: string;
}

/**
 * Normalizes loose tool input from various LLM flavors:
 * - handles options as string[] or object[]
 * - handles stringified JSON input
 * - handles alternative property names (label, answer, description, option, choice)
 */
function normalizeQuizData(raw: unknown): {
  title: string;
  premise?: string;
  question: string;
  hint?: string;
  options: NormalizedOption[];
  initialSelectedId: string | null;
} {
  let parsed: Record<string, unknown> = {};
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  } else if (raw && typeof raw === "object") {
    parsed = raw as Record<string, unknown>;
  }

  const title = String(parsed.title || "Teka-teki Logika");
  const premise = parsed.premise ? String(parsed.premise) : undefined;
  const question = String(parsed.question || "");
  const hint = parsed.hint ? String(parsed.hint) : undefined;

  const rawOptions = Array.isArray(parsed.options)
    ? parsed.options
    : Array.isArray(parsed.choices)
      ? parsed.choices
      : [];

  const defaultIds = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const initialSelectedId = parsed.selectedId ? String(parsed.selectedId) : null;

  const options: NormalizedOption[] = rawOptions.map((item, idx) => {
    const fallbackId = defaultIds[idx] ?? String(idx + 1);

    if (typeof item === "string" || typeof item === "number") {
      return {
        id: fallbackId,
        text: String(item),
      };
    }

    if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const id = String(obj.id ?? obj.key ?? obj.letter ?? fallbackId);
      const text = String(
        obj.text ??
          obj.label ??
          obj.answer ??
          obj.description ??
          obj.content ??
          obj.option ??
          obj.choice ??
          ""
      );
      const isCorrect =
        obj.isCorrect === true ||
        obj.correct === true ||
        obj.is_correct === true ||
        Boolean(obj.isAnswer);
      const explanation = obj.explanation ? String(obj.explanation) : undefined;

      return { id, text, isCorrect, explanation };
    }

    return { id: fallbackId, text: String(item ?? "") };
  });

  return { title, premise, question, hint, options, initialSelectedId };
}

export function InteractiveQuizWidget({
  data,
  toolCallId,
  messageId,
  chatId,
}: InteractiveQuizWidgetProps) {
  const { title, premise, question, hint, options, initialSelectedId } =
    normalizeQuizData(data);
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  const [showHint, setShowHint] = useState(false);

  const selectedOption = options.find((opt) => opt.id === selectedId);

  async function handleSelect(id: string) {
    setSelectedId(id);

    // Persist choice to database if message and chat IDs are present
    if (chatId && messageId && toolCallId) {
      try {
        await fetch(
          `/api/v1/chats/${chatId}/messages/${messageId}/tool-state`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              toolCallId,
              selectedId: id,
            }),
          }
        );
      } catch (err) {
        console.error("[TOOL_STATE_PERSIST_ERROR]", err);
      }
    }
  }

  return (
    <div className="my-4 rounded-[14px] border border-[var(--border)] bg-[var(--panel)]/60 backdrop-blur-xs overflow-hidden shadow-sm font-sans">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--panel)]/40 select-none">
        <div className="flex items-center gap-2 min-w-0">
          <HelpCircle className="w-4 h-4 text-[var(--accent)] shrink-0" />
          <span className="text-[13px] font-semibold text-[var(--ink)] truncate">
            {title}
          </span>
        </div>
        {hint ? (
          <button
            type="button"
            onClick={() => setShowHint((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 px-2 py-1 rounded-[6px] text-[11.5px] font-medium transition-colors cursor-pointer",
              showHint
                ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                : "text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)]"
            )}
          >
            <Lightbulb className="w-3.5 h-3.5" />
            <span>{showHint ? "Tutup Petunjuk" : "Petunjuk"}</span>
          </button>
        ) : null}
      </div>

      <div className="p-4 space-y-3.5">
        {/* Premis / Cerita latar */}
        {premise ? (
          <div className="text-[13.5px] text-[var(--muted)] leading-relaxed">
            <MarkdownRenderer content={premise} />
          </div>
        ) : null}

        {/* Hint banner */}
        {showHint && hint ? (
          <div className="p-3 rounded-[10px] bg-[var(--accent)]/10 border border-[var(--accent)]/20 text-[12.5px] text-[var(--ink)] flex items-start gap-2.5 animate-fadeIn">
            <Sparkles className="w-4 h-4 text-[var(--accent)] shrink-0 mt-0.5" />
            <div className="leading-relaxed">{hint}</div>
          </div>
        ) : null}

        {/* Pertanyaan utama */}
        {question ? (
          <div className="text-[14px] font-semibold text-[var(--ink)] leading-snug">
            {question}
          </div>
        ) : null}

        {/* Pilihan interaktif */}
        <div className="grid grid-cols-1 gap-2 pt-1">
          {options.map((opt, idx) => {
            const isSelected = selectedId === opt.id;
            const hasChosen = selectedId !== null;
            const isCorrect = opt.isCorrect;

            let stateStyle =
              "border-[var(--border)] bg-[var(--panel)]/40 hover:bg-[var(--hover)] hover:border-[var(--muted)]/40 text-[var(--ink)]";
            if (hasChosen) {
              if (isSelected) {
                stateStyle = isCorrect
                  ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                  : "border-red-500/60 bg-red-500/10 text-red-300";
              } else if (isCorrect) {
                stateStyle = "border-emerald-500/40 bg-emerald-500/5 text-emerald-400/80";
              } else {
                stateStyle = "border-[var(--border)]/50 opacity-60 text-[var(--muted)]";
              }
            }

            return (
              <button
                key={`${opt.id}-${idx}`}
                type="button"
                onClick={() => handleSelect(opt.id)}
                className={cn(
                  "w-full flex items-start gap-3 p-3 rounded-[10px] border text-left transition-all cursor-pointer text-[13px] leading-relaxed",
                  stateStyle
                )}
              >
                <span
                  className={cn(
                    "flex items-center justify-center w-5 h-5 rounded-[6px] shrink-0 font-mono text-[11px] font-semibold mt-0.5",
                    isSelected
                      ? isCorrect
                        ? "bg-emerald-500 text-black"
                        : "bg-red-500 text-white"
                      : "bg-[var(--hover)] text-[var(--muted)]"
                  )}
                >
                  {hasChosen && isSelected ? (
                    isCorrect ? (
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    ) : (
                      <X className="w-3.5 h-3.5 stroke-[3]" />
                    )
                  ) : (
                    opt.id
                  )}
                </span>
                <span className="flex-1 min-w-0 break-words font-medium text-[var(--ink)]">
                  {opt.text || `Pilihan ${opt.id}`}
                </span>
              </button>
            );
          })}
        </div>

        {/* Feedback & Penjelasan */}
        {selectedOption ? (
          <div
            className={cn(
              "p-3 rounded-[10px] text-[12.5px] leading-relaxed border animate-fadeIn",
              selectedOption.isCorrect
                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                : "bg-amber-500/10 border-amber-500/20 text-amber-200"
            )}
          >
            <div className="font-semibold mb-1">
              {selectedOption.isCorrect ? "Jawaban Tepat! 🎉" : "Kurang Tepat 🤔"}
            </div>
            {selectedOption.explanation ? (
              <div className="opacity-90">{selectedOption.explanation}</div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
