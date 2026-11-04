"use client";

import React, { useRef, useState } from "react";
import { ArrowUpRight, Loader2, Sparkles } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import { useHomeSuggestions } from "@/hooks/use-home-suggestions";
import { cn } from "@/lib/cn";
import { PerchedMascot, type PerchedMascotHandle } from "./perched-mascot";
import { CardCrack, generateCrack, type CrackShape } from "./card-crack";
import { TypewriterHeadline, type TypewriterState } from "./typewriter-headline";

/** Safety net: send even if the punch animation never reports back */
const PUNCH_TIMEOUT_MS = 1000;
/** If sending failed and home is still shown, clear the cracked card after this long */
const CRACK_RESET_MS = 3000;

interface WelcomeProps {
  onSelectPrompt: (prompt: string) => void;
}

export function Welcome({ onSelectPrompt }: WelcomeProps) {
  const { t } = useI18n();
  const { headlines, prompts, isLoadingPrompts, isSettled, isRebuilding, version } = useHomeSuggestions();
  const stageRef = useRef<HTMLDivElement>(null);
  const typewriterRef = useRef<TypewriterState | null>(null);
  const mascotRef = useRef<PerchedMascotHandle>(null);
  // The mascot standing in front of the caret makes the typing slow and strained
  const [isMascotPushing, setIsMascotPushing] = useState(false);
  // A clicked card is punched (and cracks) before its prompt is sent
  const [punchedIndex, setPunchedIndex] = useState<number | null>(null);
  const [crack, setCrack] = useState<{ index: number; shape: CrackShape } | null>(null);

  async function handleSelectCard(index: number, prompt: string) {
    if (punchedIndex !== null) return;
    setPunchedIndex(index);
    // Send as soon as the punch lands rather than after the whole recoil, so slow
    // devices don't sit on a click that seems to do nothing
    let notifyImpact: () => void = () => {};
    const impact = new Promise<void>((resolve) => (notifyImpact = resolve));
    const punch =
      mascotRef.current?.punch(index, (hit) => {
        setCrack({ index, shape: generateCrack(hit.x, hit.y, hit.width, hit.height) });
        notifyImpact();
      }) ?? Promise.resolve();
    await Promise.race([impact, punch, new Promise((r) => setTimeout(r, PUNCH_TIMEOUT_MS))]);
    onSelectPrompt(prompt);
    setTimeout(() => {
      setPunchedIndex(null);
      setCrack(null);
    }, CRACK_RESET_MS);
  }

  return (
    <div className="min-h-full flex flex-col justify-center">
      {/* Stage the mascot roams in: it lands on elements marked data-perch */}
      <div ref={stageRef} className="relative w-full max-w-[768px] mx-auto px-4 sm:px-5 py-8 sm:py-12">
        <PerchedMascot
          ref={mascotRef}
          stageRef={stageRef}
          typewriterRef={typewriterRef}
          onPushingChange={setIsMascotPushing}
        />

        {/* Top margin leaves room for the mascot standing on the headline; min height
            reserves two lines so wrapping headlines don't push the content around */}
        <div className="mt-12 min-h-[2.5em] text-3xl sm:text-4xl">
          <TypewriterHeadline
            phrases={headlines}
            paused={!isSettled}
            slowed={isMascotPushing}
            stateRef={typewriterRef}
          />
        </div>

        <p className="text-sm text-[var(--muted)] mt-3 max-w-[55ch]">{t("welcome.hint")}</p>

        {/* Quick prompts come only from the server: skeletons while fetching, and the
            whole section is left out when the user has no personalized set */}
        {(isLoadingPrompts || prompts) && (
          <div className="mt-10">
            <p className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--muted)] mb-2.5">
              {isRebuilding ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />
              ) : prompts ? (
                <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
              ) : null}
              <span data-perch={prompts ? "label" : undefined}>
                {isRebuilding ? t("welcome.preparingPrompts") : t("welcome.quickPrompts")}
              </span>
            </p>

            <div
              className={cn(
                "grid grid-cols-1 sm:grid-cols-2 gap-2.5",
                // No second click (or hover lift) while a card is being punched
                punchedIndex !== null && "pointer-events-none"
              )}
            >
              {prompts
                ? prompts.map((item, i) => (
                    <button
                      key={`${version}-${item.id}`}
                      type="button"
                      data-perch="card"
                      onClick={() => void handleSelectCard(i, item.prompt)}
                      // Cards come in one at a time
                      style={{ animationDelay: `${i * 220}ms` }}
                      className={cn(
                        "group relative flex flex-col gap-1 p-3.5 pr-9 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] text-left hover:border-[var(--accent)] hover:-translate-y-0.5 transition-[border-color,transform] cursor-pointer animate-[rise-in_380ms_ease-out_both]",
                        crack?.index === i && "overflow-hidden border-[var(--muted)]"
                      )}
                    >
                      {crack?.index === i ? <CardCrack crack={crack.shape} /> : null}
                      <span className="text-sm font-medium text-[var(--ink)] leading-snug line-clamp-1">
                        {item.label}
                      </span>
                      <span className="text-[12.5px] text-[var(--muted)] leading-relaxed line-clamp-2">
                        {item.prompt}
                      </span>
                      <ArrowUpRight className="absolute top-3.5 right-3 w-4 h-4 text-[var(--muted)] opacity-0 group-hover:opacity-100 group-hover:text-[var(--accent)] transition-opacity" />
                    </button>
                  ))
                : Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={`skeleton-${i}`}
                      aria-hidden="true"
                      className="flex flex-col gap-2.5 p-3.5 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] animate-pulse"
                      style={{ animationDelay: `${i * 150}ms` }}
                    >
                      <span className="h-3.5 w-3/5 rounded-full bg-[var(--hover)]" />
                      <span className="h-3 w-full rounded-full bg-[var(--hover)]" />
                      <span className="h-3 w-4/5 rounded-full bg-[var(--hover)]" />
                    </div>
                  ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
