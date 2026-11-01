"use client";

import React, { useRef, useState } from "react";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import { useHomeSuggestions } from "@/hooks/use-home-suggestions";
import { PerchedMascot } from "./perched-mascot";
import { TypewriterHeadline, type TypewriterState } from "./typewriter-headline";

interface WelcomeProps {
  onSelectPrompt: (prompt: string) => void;
}

export function Welcome({ onSelectPrompt }: WelcomeProps) {
  const { t } = useI18n();
  const { suggestions, isPersonalized, isSettled } = useHomeSuggestions();
  const stageRef = useRef<HTMLDivElement>(null);
  const typewriterRef = useRef<TypewriterState | null>(null);
  // The mascot standing in front of the caret makes the typing slow and strained
  const [isMascotPushing, setIsMascotPushing] = useState(false);

  return (
    <div className="min-h-full flex flex-col justify-center">
      {/* Stage the mascot roams in: it lands on elements marked data-perch */}
      <div ref={stageRef} className="relative w-full max-w-[768px] mx-auto px-4 sm:px-5 py-8 sm:py-12">
        <PerchedMascot
          stageRef={stageRef}
          typewriterRef={typewriterRef}
          onPushingChange={setIsMascotPushing}
        />

        {/* Top margin leaves room for the mascot standing on the headline; min height
            reserves two lines so wrapping headlines don't push the content around */}
        <div className="mt-12 min-h-[2.5em] text-3xl sm:text-4xl">
          <TypewriterHeadline
            phrases={suggestions.headlines}
            paused={!isSettled}
            slowed={isMascotPushing}
            stateRef={typewriterRef}
          />
        </div>

        <p className="text-sm text-[var(--muted)] mt-3 max-w-[55ch]">{t("welcome.hint")}</p>

        <div className="mt-10">
          <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-2.5">
            {isPersonalized ? <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" /> : null}
            <span data-perch="label">{t("welcome.quickPrompts")}</span>
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {suggestions.prompts.map((item, i) => (
              <button
                key={item.id}
                type="button"
                disabled={!isSettled}
                data-perch={isSettled ? "card" : undefined}
                onClick={() => onSelectPrompt(item.prompt)}
                style={{ animationDelay: `${i * 60}ms` }}
                className={
                  isSettled
                    ? "group relative flex flex-col gap-1 p-3.5 pr-9 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] text-left hover:border-[var(--accent)] hover:-translate-y-0.5 transition-[border-color,transform] cursor-pointer animate-[rise-in_380ms_ease-out_both]"
                    : "relative flex flex-col gap-1 p-3.5 pr-9 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] text-left opacity-0"
                }
              >
                <span className="text-sm font-medium text-[var(--ink)] leading-snug line-clamp-1">
                  {item.label}
                </span>
                <span className="text-[12.5px] text-[var(--muted)] leading-relaxed line-clamp-2">
                  {item.prompt}
                </span>
                <ArrowUpRight className="absolute top-3.5 right-3 w-4 h-4 text-[var(--muted)] opacity-0 group-hover:opacity-100 group-hover:text-[var(--accent)] transition-opacity" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
