"use client";

import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import "./devnuby-logo.css";

/**
 * DevNuby Interactive Mascot ("Cyber Mochi" DNA)
 *  - Shape: Mochi Git (squishy body + floating git-branch antenna)
 *  - Idle Moods:
 *      1. "wink-omega": Anime Wink + Mochi Cat (> ω ●_)
 *      2. "starry-kawaii": Big Glossy Anime Eyes (● ◡ ●_)
 *      3. "happy-chevrons": Excited Chibi Laugh (> ᴗ <_)
 *      4. "smug-dev": Playful Dev Smirk (● ‿ <_)
 *  - Dynamic Cheek Blush smoothly adapts to each expression
 *  - Hover: Eye blinking, antenna wiggle, mascot elevation
 *  - Click: Excited laugh (> ᴗ <) + full cheek blush burst
 *  - Clean Wordmark: "DevNuby" + Git Node (no terminal tag)
 */

const C = {
  bg: ["#131B36", "#0B1022", "#181030"],
  border: "#38BDF8",
  aura: "#38BDF8",
  body: ["#ECFEFF", "#A5F3FC", "#818CF8", "#A855F7"],
  shade: "#4338CA",
  shadow: "#050814",
  ink: "#0F172A",
  sparkle: "#A5F3FC",
  cursor: ["#F472B6", "#FB7185"],
  blush: "#F43F5E",
  branch: "#A5F3FC",
  word: ["#38BDF8", "#818CF8", "#E879F9"],
};

const MOCHI_GIT_PATH =
  "M31.5 15.5C41.5 15.5 47.8 21.2 50.2 30.2C52.4 38.4 49.8 46.8 42.5 49.8C38.5 51.4 35 51.8 31.5 51.8C28 51.8 24.5 51.4 20.5 49.8C13.2 46.8 10.6 38.4 12.8 30.2C15.2 21.2 21.5 15.5 31.5 15.5Z";

export const MASCOT_MOODS = [
  "wink-omega",
  "starry-kawaii",
  "happy-chevrons",
  "smug-dev",
] as const;

export type MascotMood = (typeof MASCOT_MOODS)[number];

export const DOT_TARGETS = ["v", "n", "u", "b", "y"] as const;
export type DotTarget = (typeof DOT_TARGETS)[number];

export const DOT_POSITIONS: Record<DotTarget, { x: number; y: number }> = {
  v: { x: -55, y: 6.5 },
  n: { x: -29, y: -1 },
  u: { x: -11, y: 6.5 },
  b: { x: 0, y: 0 },
  y: { x: 26, y: 6.5 },
};

const LAUGH_DURATION_MS = 1500;
const HOP_DURATION_MS = 720;

export interface UseWordmarkDotHopOptions {
  enabled?: boolean;
  minIntervalMs?: number;
  maxIntervalMs?: number;
  isPaused?: boolean;
}

export function useWordmarkDotHop(options?: UseWordmarkDotHopOptions) {
  const { enabled = true, minIntervalMs = 2800, maxIntervalMs = 4600, isPaused = false } = options ?? {};
  const [target, setTarget] = useState<DotTarget>("b");
  const [jumpDir, setJumpDir] = useState<"left" | "right">("right");
  const [isHopping, setIsHopping] = useState(false);
  const [hopCount, setHopCount] = useState(0);
  const hopEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nextHopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPausedRef = useRef(isPaused);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    if (!enabled) return;

    let mounted = true;

    const scheduleNextHop = () => {
      const delay = Math.floor(Math.random() * (maxIntervalMs - minIntervalMs + 1)) + minIntervalMs;
      nextHopTimerRef.current = setTimeout(() => {
        if (!mounted) return;
        if (isPausedRef.current) {
          scheduleNextHop();
          return;
        }

        setTarget((prev) => {
          const candidates = DOT_TARGETS.filter((t) => t !== prev);
          const next = candidates[Math.floor(Math.random() * candidates.length)] ?? "b";
          const prevX = DOT_POSITIONS[prev].x;
          const nextX = DOT_POSITIONS[next].x;
          setJumpDir(nextX >= prevX ? "right" : "left");
          return next;
        });

        setHopCount((c) => c + 1);
        setIsHopping(true);
        if (hopEndTimerRef.current) clearTimeout(hopEndTimerRef.current);
        hopEndTimerRef.current = setTimeout(() => {
          if (mounted) setIsHopping(false);
        }, HOP_DURATION_MS);

        scheduleNextHop();
      }, delay);
    };

    scheduleNextHop();

    return () => {
      mounted = false;
      if (nextHopTimerRef.current) clearTimeout(nextHopTimerRef.current);
      if (hopEndTimerRef.current) clearTimeout(hopEndTimerRef.current);
    };
  }, [enabled, minIntervalMs, maxIntervalMs]);

  return { target, jumpDir, isHopping, hopCount };
}

export interface UseMascotIdleOptions {
  autoCycle?: boolean;
  cycleIntervalMs?: number;
  initialMood?: MascotMood;
}

export function useMascotIdle(options?: UseMascotIdleOptions) {
  const { autoCycle = true, cycleIntervalMs = 4500, initialMood = "wink-omega" } = options ?? {};
  const [mood, setMood] = useState<MascotMood>(initialMood);
  const [laughing, setLaughing] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Smoothly cycle through idle moods when user isn't hovering or clicking
  useEffect(() => {
    if (!autoCycle) return;
    const interval = setInterval(() => {
      if (isHovered || laughing) return;
      setMood((prev) => {
        const nextIdx = (MASCOT_MOODS.indexOf(prev) + 1) % MASCOT_MOODS.length;
        return MASCOT_MOODS[nextIdx];
      });
    }, cycleIntervalMs);

    return () => clearInterval(interval);
  }, [autoCycle, cycleIntervalMs, isHovered, laughing]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const triggerLaugh = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setLaughing(true);
    timerRef.current = setTimeout(() => {
      setLaughing(false);
    }, LAUGH_DURATION_MS);
  }, []);

  return {
    mood,
    setMood,
    laughing,
    triggerLaugh,
    isHovered,
    setIsHovered,
  };
}

/** Shared 64×64 squircle mascot tile (Mochi Git shape + layered smooth expressions) */
function MascotTile({ p, blinkCursor }: { p: string; blinkCursor?: boolean }) {
  return (
    <>
      <defs>
        <linearGradient id={`${p}-bg`} x1="8" y1="4" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={C.bg[0]} />
          <stop offset="0.55" stopColor={C.bg[1]} />
          <stop offset="1" stopColor={C.bg[2]} />
        </linearGradient>
        <radialGradient id={`${p}-aura`} cx="32" cy="34" r="27" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={C.aura} stopOpacity="0.42" />
          <stop offset="0.55" stopColor={C.aura} stopOpacity="0.16" />
          <stop offset="1" stopColor={C.bg[1]} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${p}-body`} x1="18" y1="12" x2="46" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={C.body[0]} />
          <stop offset="0.48" stopColor={C.body[1]} />
          <stop offset="0.82" stopColor={C.body[2]} />
          <stop offset="1" stopColor={C.body[3]} />
        </linearGradient>
        <linearGradient id={`${p}-shade`} x1="32" y1="34" x2="32" y2="52" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={C.shade} stopOpacity="0" />
          <stop offset="1" stopColor={C.shade} stopOpacity="0.45" />
        </linearGradient>
        <linearGradient id={`${p}-cursor`} x1="34" y1="38" x2="46" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={C.cursor[0]} />
          <stop offset="1" stopColor={C.cursor[1]} />
        </linearGradient>
        <filter id={`${p}-shadow`} x="4" y="4" width="56" height="56" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feDropShadow dx="0" dy="4" stdDeviation="3.5" floodColor={C.shadow} floodOpacity="0.55" />
        </filter>
      </defs>

      <rect width="64" height="64" rx="18" fill={`url(#${p}-bg)`} />
      <rect x="1" y="1" width="62" height="62" rx="17" stroke={C.border} strokeOpacity="0.22" strokeWidth="1.5" />
      <circle cx="32" cy="34" r="27" fill={`url(#${p}-aura)`} />

      <g filter={`url(#${p}-shadow)`}>
        <g className="dn-mascot">
          {/* Mochi Git Antenna / Floating Git Branch */}
          <g className="dn-antenna">
            <path d="M37 18C39 14.5 41.5 13 44 12.5" stroke={C.branch} strokeWidth="2.6" strokeLinecap="round" />
            <circle cx="44.5" cy="12" r="4.2" fill={`url(#${p}-body)`} />
            <circle cx="43.3" cy="10.8" r="1.4" fill="#FFFFFF" opacity="0.95" />
            <circle cx="35.5" cy="10.5" r="2.3" fill={C.branch} />
          </g>

          {/* Squishy Mochi Body & Specular Highlights */}
          <path fill={`url(#${p}-body)`} d={MOCHI_GIT_PATH} />
          <path fill={`url(#${p}-shade)`} d={MOCHI_GIT_PATH} />
          <ellipse cx="23.5" cy="21.5" rx="6.5" ry="3" transform="rotate(-25 23.5 21.5)" fill="#FFFFFF" opacity="0.88" />
          <circle cx="17.5" cy="25.5" r="1.4" fill="#FFFFFF" opacity="0.75" />

          {/* Dynamic Cheek Blush (Smoothly adjusts opacity and scale per mood) */}
          <g className="dn-blush">
            <ellipse cx="18.2" cy="37.8" rx="3.8" ry="2.2" fill={C.blush} />
            <ellipse cx="44.8" cy="37.8" rx="3.8" ry="2.2" fill={C.blush} />
            <path d="M17.0 38.5L18.1 37.0M18.9 38.6L20.0 37.1" stroke="#FFE4E6" strokeWidth="1" strokeLinecap="round" />
            <path d="M43.6 38.5L44.7 37.0M45.5 38.6L46.6 37.1" stroke="#FFE4E6" strokeWidth="1" strokeLinecap="round" />
          </g>

          {/* 1. Face: Anime Wink + Mochi Cat (> ω ●_) */}
          <g className="dn-face-layer dn-face-wink-omega">
            <g className="dn-eyes dn-wink-eyes">
              <path d="M20.5 29.5L26.8 33.8L20.5 38.1" stroke={C.ink} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
              <ellipse cx="40.5" cy="33.8" rx="3.8" ry="4.4" fill={C.ink} />
              <circle cx="39.1" cy="32.1" r="1.5" fill="#FFFFFF" />
              <circle cx="41.8" cy="35.3" r="0.8" fill={C.sparkle} />
            </g>
            <path d="M29.2 37.8C29.8 39.6 31.5 39.8 32.3 38.2C33.1 39.8 34.8 39.6 35.4 37.8" stroke={C.ink} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </g>

          {/* 2. Face: Big Glossy Anime Eyes (● ◡ ●_) */}
          <g className="dn-face-layer dn-face-starry-kawaii">
            <g className="dn-eyes dn-kawaii-eyes">
              <ellipse cx="23.2" cy="33.8" rx="3.8" ry="4.5" fill={C.ink} />
              <circle cx="21.8" cy="32.0" r="1.5" fill="#FFFFFF" />
              <circle cx="24.5" cy="35.3" r="0.8" fill={C.sparkle} />
              <ellipse cx="40.2" cy="33.8" rx="3.8" ry="4.5" fill={C.ink} />
              <circle cx="38.8" cy="32.0" r="1.5" fill="#FFFFFF" />
              <circle cx="41.5" cy="35.3" r="0.8" fill={C.sparkle} />
            </g>
            <path d="M29.5 37.8C30.6 39.8 32.8 39.8 33.9 37.8" stroke={C.ink} strokeWidth="2.5" strokeLinecap="round" />
          </g>

          {/* 3. Face: Excited Chibi Laugh (> ᴗ <_) with open laughing mouth & tongue */}
          <g className="dn-face-layer dn-face-happy-chevrons">
            <g className="dn-eyes">
              <path d="M20.2 30.2L26.2 34.0L20.2 37.8" stroke={C.ink} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M43.2 30.2L37.2 34.0L43.2 37.8" stroke={C.ink} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            </g>
            <path d="M28.5 37.2H35.1C35.1 41.8 28.5 41.8 28.5 37.2Z" fill="#F43F5E" stroke={C.ink} strokeWidth="2.2" strokeLinejoin="round" />
            <path d="M30.0 39.2C31.0 38.3 32.6 38.3 33.6 39.2" stroke="#FDA4AF" strokeWidth="1.6" strokeLinecap="round" />
          </g>

          {/* 4. Face: Playful Dev Smirk (● ‿ <_) */}
          <g className="dn-face-layer dn-face-smug-dev">
            <g className="dn-eyes dn-smug-eyes">
              <ellipse cx="23.2" cy="33.8" rx="3.8" ry="4.4" fill={C.ink} />
              <circle cx="21.8" cy="32.1" r="1.5" fill="#FFFFFF" />
              <circle cx="24.5" cy="35.3" r="0.8" fill={C.sparkle} />
              <path d="M43.0 29.8L37.0 33.8L43.0 37.8" stroke={C.ink} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            </g>
            <path d="M29.2 38.2C31.2 39.6 33.5 38.8 34.6 37.2" stroke={C.ink} strokeWidth="2.5" strokeLinecap="round" />
          </g>

          {/* Click Laugh Face Expression */}
          <g className="dn-face-laugh">
            <path d="M19.8 30.0L26.2 33.8L19.8 37.6" stroke={C.ink} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M43.6 30.0L37.2 33.8L43.6 37.6" stroke={C.ink} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M28.5 37.2H35.1C35.1 41.8 28.5 41.8 28.5 37.2Z" fill="#F43F5E" stroke={C.ink} strokeWidth="2.2" strokeLinejoin="round" />
            <path d="M30.0 39.2C31.0 38.3 32.6 38.3 33.6 39.2" stroke="#FDA4AF" strokeWidth="1.6" strokeLinecap="round" />
          </g>

          {/* Terminal Prompt Underline Cursor */}
          <path d="M38.2 43.2H44.2" stroke={`url(#${p}-cursor)`} strokeWidth="3.2" strokeLinecap="round">
            {blinkCursor ? <animate attributeName="opacity" values="1;0.2;1" dur="1.2s" repeatCount="indefinite" /> : null}
          </path>
        </g>
      </g>
    </>
  );
}

export interface DevnubyIconProps {
  className?: string;
  mood?: MascotMood;
  autoCycle?: boolean;
  cycleIntervalMs?: number;
  interactive?: boolean;
  blinkCursor?: boolean;
  title?: string;
}

/** 64×64 squircle app icon with dynamic smooth idle expressions & click-laugh */
export function DevnubyIcon({
  className,
  mood: controlledMood,
  autoCycle = true,
  cycleIntervalMs,
  interactive = true,
  blinkCursor,
  title = "DevNuby",
}: DevnubyIconProps) {
  const p = `dn${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const idle = useMascotIdle({ autoCycle: autoCycle && !controlledMood, cycleIntervalMs });
  const activeMood = controlledMood ?? idle.mood;

  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label={title}
      data-mood={activeMood}
      onClick={interactive ? idle.triggerLaugh : undefined}
      onMouseEnter={interactive ? () => idle.setIsHovered(true) : undefined}
      onMouseLeave={interactive ? () => idle.setIsHovered(false) : undefined}
      className={cn(
        "dn-logo shrink-0 select-none",
        interactive && "dn-interactive",
        idle.laughing && "is-laughing",
        className
      )}
    >
      <MascotTile p={p} blinkCursor={blinkCursor} />
    </svg>
  );
}

export interface DevnubyWordmarkProps {
  className?: string;
  mood?: MascotMood;
  autoCycle?: boolean;
  cycleIntervalMs?: number;
  interactive?: boolean;
  title?: string;
}

/** Clean Horizontal Wordmark: Mascot + "DevNuby" + Git Node (No Terminal Tag) */
export function DevnubyWordmark({
  className,
  mood: controlledMood,
  autoCycle = true,
  cycleIntervalMs,
  interactive = true,
  title = "DevNuby",
}: DevnubyWordmarkProps) {
  const p = `dnw${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const idle = useMascotIdle({ autoCycle: autoCycle && !controlledMood, cycleIntervalMs });
  const activeMood = controlledMood ?? idle.mood;
  const dotHop = useWordmarkDotHop({
    enabled: autoCycle,
    isPaused: idle.isHovered || idle.laughing,
  });

  return (
    <svg
      viewBox="0 0 236 64"
      fill="none"
      role="img"
      aria-label={title}
      data-mood={activeMood}
      data-dot={dotHop.target}
      data-jump-dir={dotHop.jumpDir}
      onClick={interactive ? idle.triggerLaugh : undefined}
      onMouseEnter={interactive ? () => idle.setIsHovered(true) : undefined}
      onMouseLeave={interactive ? () => idle.setIsHovered(false) : undefined}
      className={cn(
        "dn-logo dn-wordmark shrink-0 select-none overflow-visible",
        interactive && "dn-interactive",
        idle.laughing && "is-laughing",
        className
      )}
    >
      <MascotTile p={p} />
      <defs>
        <linearGradient id={`${p}-word`} x1="142" y1="16" x2="216" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={C.word[0]} />
          <stop offset="0.5" stopColor={C.word[1]} />
          <stop offset="1" stopColor={C.word[2]} />
        </linearGradient>
      </defs>

      <g className="dn-wordmark-group">
        <text
          x="78"
          y="43"
          fill="var(--ink)"
          fontFamily="var(--font-jakarta), 'Plus Jakarta Sans', system-ui, sans-serif"
          fontWeight="800"
          fontSize="33"
          letterSpacing="-1"
        >
          Dev
        </text>
        <text
          x="141"
          y="43"
          fill={`url(#${p}-word)`}
          fontFamily="var(--font-jakarta), 'Plus Jakarta Sans', system-ui, sans-serif"
          fontWeight="800"
          fontSize="33"
          letterSpacing="-0.8"
        >
          Nuby
        </text>

        {/* Floating Git-Branch Accent Dot (Juicy physics jump, bounce, stretch, and dynamic antenna rotation) */}
        <g
          className="dn-nuby-dot"
          style={{
            transform: `translate(${DOT_POSITIONS[dotHop.target].x}px, ${DOT_POSITIONS[dotHop.target].y}px)`,
          }}
        >
          <g
            key={`jump-${dotHop.hopCount}`}
            className={cn("dn-nuby-jump", dotHop.isHopping && "is-jumping")}
          >
            <g
              className={cn(
                "dn-nuby-body",
                dotHop.isHopping && (dotHop.jumpDir === "left" ? "is-jumping-left" : "is-jumping-right")
              )}
            >
              {/* Git node anchor commit circle */}
              <circle cx="192" cy="12" r="3.2" fill={C.word[0]} />
              {/* Swiveling / dynamic organic antenna stem & tip */}
              <g className="dn-nuby-antenna">
                <path d="M192 12L203 9.5" stroke={C.word[0]} strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="203" cy="9.5" r="2" fill={C.cursor[0]} />
              </g>
            </g>
          </g>
        </g>
      </g>
    </svg>
  );
}
