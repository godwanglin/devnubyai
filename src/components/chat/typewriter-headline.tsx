"use client";

import React, { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

const TYPE_MS = 45;
/** Per-character delay while something (the mascot) is pushing back against the caret */
const TYPE_SLOWED_MS = 170;
const DELETE_MS = 22;
const HOLD_MIN_MS = 2500;
const HOLD_MAX_MS = 3000;
const GAP_MS = 350;

type Phase = "typing" | "holding" | "deleting";

/** Live progress, shared through a ref (no re-renders) with whoever reacts to the typing */
export interface TypewriterState {
  phase: Phase | "paused";
  /** Index of the current phrase; changes when a new phrase starts */
  index: number;
  typed: number;
  total: number;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return reduced;
}

interface TypewriterHeadlineProps {
  phrases: string[];
  /** Hold the first frame (empty) until true, e.g. while the phrase list may still change */
  paused?: boolean;
  /** Typing becomes slow and strained, as if pushing against something in front of the caret */
  slowed?: boolean;
  stateRef?: React.RefObject<TypewriterState | null>;
  className?: string;
}

/**
 * Cycles through `phrases`: types one out, holds it 2.5-3s, deletes it, types the next.
 * With reduced motion it just swaps whole phrases with a fade on the same rhythm.
 * The text span and the caret carry `data-perch` so the home mascot can stand on them.
 */
export function TypewriterHeadline({
  phrases,
  paused = false,
  slowed = false,
  stateRef,
  className,
}: TypewriterHeadlineProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [length, setLength] = useState(0);
  const [phase, setPhase] = useState<Phase>("typing");

  // Restart from the first phrase whenever the list itself changes
  const listKey = phrases.join("\u0000");
  const [prevKey, setPrevKey] = useState(listKey);
  if (prevKey !== listKey) {
    setPrevKey(listKey);
    setIndex(0);
    setLength(0);
    setPhase("typing");
  }

  const phrase = phrases[index % Math.max(phrases.length, 1)] ?? "";

  useEffect(() => {
    if (!stateRef) return;
    stateRef.current = {
      phase: paused ? "paused" : phase,
      index,
      typed: reducedMotion ? phrase.length : length,
      total: phrase.length,
    };
  }, [stateRef, paused, phase, index, length, phrase.length, reducedMotion]);

  useEffect(() => {
    if (paused || phrases.length === 0) return;

    if (reducedMotion) {
      if (phrases.length < 2) return;
      const timer = setTimeout(
        () => setIndex((i) => (i + 1) % phrases.length),
        HOLD_MIN_MS + Math.random() * (HOLD_MAX_MS - HOLD_MIN_MS)
      );
      return () => clearTimeout(timer);
    }

    let timer: ReturnType<typeof setTimeout>;
    if (phase === "typing") {
      timer =
        length < phrase.length
          ? setTimeout(
              () => setLength((l) => l + 1),
              slowed ? TYPE_SLOWED_MS + Math.random() * 90 : TYPE_MS + Math.random() * 30
            )
          : setTimeout(() => setPhase("holding"), 0);
    } else if (phase === "holding") {
      // A single phrase just stays on screen
      if (phrases.length < 2) return;
      timer = setTimeout(
        () => setPhase("deleting"),
        HOLD_MIN_MS + Math.random() * (HOLD_MAX_MS - HOLD_MIN_MS)
      );
    } else {
      timer =
        length > 0
          ? setTimeout(() => setLength((l) => l - 1), DELETE_MS)
          : setTimeout(() => {
              setIndex((i) => (i + 1) % phrases.length);
              setPhase("typing");
            }, GAP_MS);
    }
    return () => clearTimeout(timer);
  }, [paused, slowed, reducedMotion, phrases.length, phrase.length, phase, length]);

  const visible = reducedMotion ? phrase : phrase.slice(0, length);
  const straining = slowed && phase === "typing" && !reducedMotion;

  return (
    <h1
      aria-label={phrase}
      className={cn(
        "text-3xl sm:text-4xl font-bold tracking-tight text-[var(--ink)] leading-tight",
        straining && "animate-[type-strain_120ms_ease-in-out_infinite_alternate]",
        className
      )}
    >
      <span aria-hidden="true">
        <span className="text-[var(--accent)] mr-2 select-none">&gt;</span>
        <span
          data-perch="headline"
          key={reducedMotion ? index : undefined}
          className={reducedMotion ? "animate-[fade-in_400ms_ease-out]" : undefined}
        >
          {paused ? "" : visible}
        </span>
        <span
          data-perch="caret"
          className={cn(
            "inline-block w-1 h-7 sm:h-8 ml-1.5 bg-[var(--accent)] align-middle",
            straining ? "opacity-100" : "animate-pulse"
          )}
        />
      </span>
    </h1>
  );
}
