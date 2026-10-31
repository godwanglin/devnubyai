"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";
import "./devnuby-loader.css";

export type DevnubyLoaderState = "thinking" | "tools" | "normal" | "done";

export interface LoaderStateConfig {
  id: DevnubyLoaderState;
  tabLabel: string;
  badge: string;
  subtext: string;
  badgeStyle: string;
  progressClass: string;
}

export const LOADER_STATES: Record<DevnubyLoaderState, LoaderStateConfig> = {
  thinking: { id: "thinking", tabLabel: "1. Berpikir (Thought)", badge: "Thought...", subtext: "Menimbang solusi terbaik & menyusun thought process...", badgeStyle: "bg-indigo-500/20 text-indigo-300 border-indigo-400/30", progressClass: "from-indigo-500 via-sky-400 to-cyan-300" },
  tools: { id: "tools", tabLabel: "2. Menjalankan Tools", badge: "Menjalankan tools...", subtext: "Menjalankan subprocess, membaca file & streaming log...", badgeStyle: "bg-cyan-500/20 text-cyan-300 border-cyan-400/30", progressClass: "from-emerald-400 via-cyan-400 to-indigo-500" },
  normal: { id: "normal", tabLabel: "3. Loading Normal", badge: "Merangkum jawaban...", subtext: "Menyusun penjelasan interaktif & memformat kode...", badgeStyle: "bg-sky-500/20 text-sky-300 border-sky-400/30", progressClass: "from-cyan-400 via-indigo-400 to-pink-400" },
  done: { id: "done", tabLabel: "4. Selesai (Loncat Gembira)", badge: "Selesai", subtext: "Jawaban berhasil digenerate, maskot loncat gembira (> ᴗ <)", badgeStyle: "bg-emerald-500/20 text-emerald-300 border-emerald-400/40", progressClass: "from-emerald-400 to-cyan-400" },
};

const ORDERED_STATES: DevnubyLoaderState[] = ["thinking", "tools", "normal", "done"];
const C = {
  body: ["#ECFEFF", "#A5F3FC", "#818CF8", "#A855F7"],
  shade: "#4338CA",
  ink: "#0F172A",
  sparkle: "#A5F3FC",
  blush: "#F43F5E",
  branch: "#A5F3FC",
};

const MOCHI_GIT_PATH =
  "M31.5 15.5C41.5 15.5 47.8 21.2 50.2 30.2C52.4 38.4 49.8 46.8 42.5 49.8C38.5 51.4 35 51.8 31.5 51.8C28 51.8 24.5 51.4 20.5 49.8C13.2 46.8 10.6 38.4 12.8 30.2C15.2 21.2 21.5 15.5 31.5 15.5Z";

export interface CursorTrackingState {
  body: { x: number; y: number; tilt: number };
  eye: { x: number; y: number };
  pupil: { x: number; y: number };
}

export const ZERO_TRACKING: CursorTrackingState = {
  body: { x: 0, y: 0, tilt: 0 }, eye: { x: 0, y: 0 }, pupil: { x: 0, y: 0 },
};

/** Smooth cursor tracking hook: calculates body tilt & eyeball displacement toward user cursor */
export function useLookAtCursor(enabled = true) {
  const [tracking, setTracking] = useState<CursorTrackingState>(ZERO_TRACKING);
  const targetRef = useRef<HTMLDivElement | SVGSVGElement | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let frameId: number | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      if (!targetRef.current) return;
      if (frameId) cancelAnimationFrame(frameId);

      frameId = requestAnimationFrame(() => {
        if (!targetRef.current) return;
        const rect = targetRef.current.getBoundingClientRect();
        const centerX = rect.left + rect.width * 0.5;
        const centerY = rect.top + rect.height * 0.45;
        const dx = e.clientX - centerX;
        const dy = e.clientY - centerY;
        const dist = Math.hypot(dx, dy);
        if (dist === 0) return;
        const angle = Math.atan2(dy, dx);
        const normDist = Math.min(dist / 260, 1);
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);

        // 1. Badan: Leans and tilts toward cursor
        const bodyX = Number((cosA * normDist * 2.8).toFixed(2));
        const bodyY = Number((sinA * normDist * 2.0).toFixed(2));
        const tilt = Number((Math.max(-1, Math.min(1, dx / 260)) * 5.2).toFixed(2));

        // 2. Bola Mata: Whole eyeball sockets shift clearly toward cursor
        const eyeX = Number((cosA * normDist * 2.2).toFixed(2));
        const eyeY = Number((sinA * normDist * 1.8).toFixed(2));

        // 3. Pupil Highlights: Extra lead inside socket for parallax depth
        const pupilX = Number((cosA * normDist * 1.1).toFixed(2));
        const pupilY = Number((sinA * normDist * 0.9).toFixed(2));

        setTracking({
          body: { x: bodyX, y: bodyY, tilt },
          eye: { x: eyeX, y: eyeY },
          pupil: { x: pupilX, y: pupilY },
        });
      });
    };

    const handleMouseLeave = () => {
      setTracking(ZERO_TRACKING);
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      window.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, [enabled]);

  return { targetRef, tracking: enabled ? tracking : ZERO_TRACKING };
}

export interface DevnubyLoaderMascotProps {
  state?: DevnubyLoaderState;
  className?: string;
  interactive?: boolean;
  tracking?: CursorTrackingState;
}

/** Pure 80×80 SVG Mascot with layered state faces (Tracks body + eyeballs + pupils) */
export function DevnubyLoaderMascot({
  state = "normal",
  className,
  interactive = true,
  tracking: externalTracking,
}: DevnubyLoaderMascotProps) {
  const p = `dnl${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const shouldTrack = state === "normal" || state === "thinking";
  const internal = useLookAtCursor(shouldTrack);
  const trk = externalTracking ?? internal.tracking;
  const svgRef = externalTracking ? undefined : (internal.targetRef as React.RefObject<SVGSVGElement>);

  return (
    <svg
      ref={svgRef}
      viewBox="-8 -16 80 80"
      fill="none"
      role="img"
      aria-label={`DevNuby AI (${state})`}
      data-state={state}
      className={cn(
        "dn-loader select-none shrink-0 overflow-visible",
        interactive && "dn-loader-interactive",
        className
      )}
    >
      <defs>
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
      </defs>

      {/* Outer Cursor-Reactive Tracker Group (Body leans & tilts toward cursor) */}
      <g
        className="dn-body-tracker"
        style={{
          transform: `translate(${trk.body.x}px, ${trk.body.y}px) rotate(${trk.body.tilt}deg)`,
        }}
      >
        {/* Inner Mascot Animation Group (Floating, jittering, or bouncing) */}
        <g className="dn-loader-mascot">
          {/* Antenna / Branch */}
          <g className="dn-antenna">
            <path d="M37 18C39 14.5 41.5 13 44 12.5" stroke={C.branch} strokeWidth="2.6" strokeLinecap="round" />
            <circle cx="44.5" cy="12" r="4.2" fill={`url(#${p}-body)`} />
            <circle cx="43.3" cy="10.8" r="1.4" fill="#FFFFFF" opacity="0.95" />
            <circle cx="35.5" cy="10.5" r="2.3" fill={C.branch} />

            {/* State 1: Thought wave rings expanding from antenna */}
            <circle cx="44.5" cy="12" r="5" stroke="#818CF8" fill="none" className="dn-thought-ring ring-1" />
            <circle cx="44.5" cy="12" r="8" stroke="#38BDF8" fill="none" className="dn-thought-ring ring-2" />
            <circle cx="44.5" cy="12" r="11" stroke="#C084FC" fill="none" className="dn-thought-ring ring-3" />
          </g>

          {/* Mochi Body & Highlights */}
          <path fill={`url(#${p}-body)`} d={MOCHI_GIT_PATH} />
          <path fill={`url(#${p}-shade)`} d={MOCHI_GIT_PATH} />
          <ellipse cx="23.5" cy="21.5" rx="6.5" ry="3" transform="rotate(-25 23.5 21.5)" fill="#FFFFFF" opacity="0.88" />
          <circle cx="17.5" cy="25.5" r="1.4" fill="#FFFFFF" opacity="0.75" />

          {/* Dynamic Cheek Blush */}
          <g className="dn-blush">
            <ellipse cx="18.2" cy="37.8" rx="3.8" ry="2.2" fill={C.blush} opacity="0.55" />
            <ellipse cx="44.8" cy="37.8" rx="3.8" ry="2.2" fill={C.blush} opacity="0.55" />
            <path d="M17.0 38.5L18.1 37.0M18.9 38.6L20.0 37.1" stroke="#FFE4E6" strokeWidth="1" strokeLinecap="round" />
            <path d="M43.6 38.5L44.7 37.0M45.5 38.6L46.6 37.1" stroke="#FFE4E6" strokeWidth="1" strokeLinecap="round" />
          </g>

          {/* ----------------------------------------------------------- */}
          {/* FACE 1: THINKING (Dua Bola Mata Melirik & Pensive Mouth)    */}
          {/* ----------------------------------------------------------- */}
          <g className="dn-loader-face dn-face-thinking">
            <g className="dn-thinking-eyes">
              {/* Left Eyeball (Socket + Highlight) */}
              <g
                className="dn-eyeball dn-eyeball-left"
                style={{
                  transform: `translate(${trk.eye.x}px, ${trk.eye.y}px)`,
                }}
              >
                <ellipse cx="25.5" cy="32.5" rx="3.6" ry="4.2" fill={C.ink} />
                <g
                  className="dn-pupil-highlight"
                  style={{
                    transform: `translate(${trk.pupil.x}px, ${trk.pupil.y}px)`,
                  }}
                >
                  <circle cx="26.8" cy="30.8" r="1.5" fill="#FFFFFF" />
                  <circle cx="24.2" cy="34.0" r="0.8" fill={C.sparkle} />
                </g>
              </g>

              {/* Right Eyeball (Socket + Highlight) */}
              <g
                className="dn-eyeball dn-eyeball-right"
                style={{
                  transform: `translate(${trk.eye.x}px, ${trk.eye.y}px)`,
                }}
              >
                <ellipse cx="41.5" cy="32.5" rx="3.6" ry="4.2" fill={C.ink} />
                <g
                  className="dn-pupil-highlight"
                  style={{
                    transform: `translate(${trk.pupil.x}px, ${trk.pupil.y}px)`,
                  }}
                >
                  <circle cx="42.8" cy="30.8" r="1.5" fill="#FFFFFF" />
                  <circle cx="40.2" cy="34.0" r="0.8" fill={C.sparkle} />
                </g>
              </g>
            </g>
            {/* Pensive mouth: subtle focused pout */}
            <circle cx="33.5" cy="38.5" r="1.8" fill={C.ink} />
            {/* Thinking sparkle twinkle beside head */}
            <path d="M14 20L15 22.5L17.5 23.5L15 24.5L14 27L13 24.5L10.5 23.5L13 22.5Z" fill="#C084FC" className="dn-thought-sparkle" />
          </g>

          {/* ----------------------------------------------------------- */}
          {/* FACE 2: TOOLS (Ekspresi Terminal Ikonik '> _' Hitam)        */}
          {/* ----------------------------------------------------------- */}
          <g className="dn-loader-face dn-face-tools">
            {/* Left Eye: Clean Black Terminal '>' (shifted up above blush) */}
            <path d="M20.5 26.0L27.5 30.5L20.5 35.0" stroke={C.ink} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />

            {/* Right Eye: Clean Black Blinking Terminal Cursor '_' */}
            <rect x="35.5" y="32.2" width="9.5" height="3.2" rx="1.6" fill={C.ink} className="dn-terminal-cursor" />

            {/* Playful Smirk Mouth */}
            <path d="M29.5 37.5C31.0 39.0 33.2 39.0 34.8 37.5" stroke={C.ink} strokeWidth="2.4" strokeLinecap="round" />

            {/* Floating Cyber Data Glyphs */}
            <text x="12" y="14" fill="#38BDF8" fontSize="6.5" fontFamily="monospace" fontWeight="bold" className="dn-matrix-bit bit-1">&gt;_</text>
            <text x="46" y="13" fill="#F472B6" fontSize="6.5" fontFamily="monospace" fontWeight="bold" className="dn-matrix-bit bit-2">&lt;/&gt;</text>
          </g>

          {/* ----------------------------------------------------------- */}
          {/* FACE 3: NORMAL (Dua Bola Mata Glossy + Senyum Kucing riang) */}
          {/* ----------------------------------------------------------- */}
          <g className="dn-loader-face dn-face-normal">
            <g className="dn-eyes dn-eyes-normal">
              {/* Left Eyeball (Socket + Highlight) */}
              <g className="dn-eyeball dn-eyeball-left" style={{ transform: `translate(${trk.eye.x}px, ${trk.eye.y}px)` }}>
                <ellipse cx="23.2" cy="33.8" rx="3.8" ry="4.5" fill={C.ink} />
                <g className="dn-pupil-highlight" style={{ transform: `translate(${trk.pupil.x}px, ${trk.pupil.y}px)` }}>
                  <circle cx="21.8" cy="32.0" r="1.5" fill="#FFFFFF" />
                  <circle cx="24.5" cy="35.3" r="0.8" fill={C.sparkle} />
                </g>
              </g>

              {/* Right Eyeball (Socket + Highlight) */}
              <g className="dn-eyeball dn-eyeball-right" style={{ transform: `translate(${trk.eye.x}px, ${trk.eye.y}px)` }}>
                <ellipse cx="40.2" cy="33.8" rx="3.8" ry="4.5" fill={C.ink} />
                <g className="dn-pupil-highlight" style={{ transform: `translate(${trk.pupil.x}px, ${trk.pupil.y}px)` }}>
                  <circle cx="38.8" cy="32.0" r="1.5" fill="#FFFFFF" />
                  <circle cx="41.5" cy="35.3" r="0.8" fill={C.sparkle} />
                </g>
              </g>
            </g>

            {/* Cute Cat Mochi Smile (w) */}
            <path
              d="M29.2 37.8C29.8 39.6 31.5 39.8 32.3 38.2C33.1 39.8 34.8 39.6 35.4 37.8"
              stroke={C.ink}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>

          {/* ----------------------------------------------------------- */}
          {/* FACE 4: DONE (Excited Chibi Laugh + Tongue)                 */}
          {/* ----------------------------------------------------------- */}
          <g className="dn-loader-face dn-face-done">
            <g className="dn-eyes">
              <path d="M20.2 30.2L26.2 34.0L20.2 37.8" stroke={C.ink} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M43.2 30.2L37.2 34.0L43.2 37.8" stroke={C.ink} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            </g>
            <path d="M28.5 37.2H35.1C35.1 41.8 28.5 41.8 28.5 37.2Z" fill="#F43F5E" stroke={C.ink} strokeWidth="2.2" strokeLinejoin="round" />
            <path d="M30.0 39.2C31.0 38.3 32.6 38.3 33.6 39.2" stroke="#FDA4AF" strokeWidth="1.6" strokeLinecap="round" />
          </g>
        </g>
      </g>
    </svg>
  );
}

export interface DevnubyLoaderInlineProps {
  state?: DevnubyLoaderState;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  labelKey?: string;
  label?: string;
  animateEnter?: boolean;
  isExiting?: boolean;
  className?: string;
}

/** Compact inline DevNuby AI working loader for chat messages & turns */
export function DevnubyLoaderInline({
  state = "normal",
  size = "md",
  showLabel = true,
  labelKey,
  label,
  animateEnter = true,
  isExiting = false,
  className,
}: DevnubyLoaderInlineProps) {
  const { t } = useI18n();
  const cfg = LOADER_STATES[state];
  const effectiveKey = labelKey || state;
  const translated = t(`loader.${effectiveKey}`);
  const displayLabel = label || (translated !== `loader.${effectiveKey}` ? translated : (effectiveKey === "processing" ? "Memproses..." : cfg.badge));
  const { targetRef, tracking } = useLookAtCursor(state === "normal" || state === "thinking");

  const sizeMap = {
    sm: { mascot: "w-9 h-9 sm:w-10 sm:h-10", shadow: "w-7 h-1.5 -mt-1", text: "text-xs" },
    md: { mascot: "w-13 h-13 sm:w-15 sm:h-15", shadow: "w-10 h-2 -mt-2.5 sm:-mt-3", text: "text-xs sm:text-[13px]" },
    lg: { mascot: "w-20 h-20 sm:w-24 sm:h-24", shadow: "w-14 h-2.5 -mt-4", text: "text-sm" },
  };
  const s = sizeMap[size];

  return (
    <div className={cn("inline-flex items-center gap-3 select-none py-1", isExiting ? "dn-loader-exit" : animateEnter && "dn-loader-enter", className)}>
      <div className="flex flex-col items-center justify-center shrink-0">
        <div ref={targetRef as React.RefObject<HTMLDivElement>} className={cn(s.mascot, "flex items-center justify-center relative overflow-visible")}>
          <DevnubyLoaderMascot state={state} tracking={tracking} className="w-full h-full overflow-visible" />
        </div>
        <div className={cn("dn-loader-shadow rounded-full bg-cyan-400/30 blur-[2px]", s.shadow)} style={{ transform: `translateX(${tracking.body.x * 0.5}px)` }} />
      </div>
      {showLabel && (
        <span className={cn("font-medium tracking-tight dn-loader-text-glass", s.text)}>
          {displayLabel}
        </span>
      )}
    </div>
  );
}

export interface DevnubyLoaderCardProps {
  className?: string;
  defaultState?: DevnubyLoaderState;
  showTabs?: boolean;
}

/** Interactive Demo Card showcasing DevNuby AI working states */
export function DevnubyLoaderCard({
  className,
  defaultState = "normal",
  showTabs = true,
}: DevnubyLoaderCardProps) {
  const { t } = useI18n();
  const [activeState, setActiveState] = useState<DevnubyLoaderState>(defaultState);
  const cfg = LOADER_STATES[activeState];
  const isInteractiveLook = activeState === "normal" || activeState === "thinking";
  const { targetRef, tracking } = useLookAtCursor(isInteractiveLook);
  const cardBadge = t(`loader.${activeState}`);
  const displayCardBadge = cardBadge !== `loader.${activeState}` ? cardBadge : cfg.badge;
  const cardSub = t(`loader.${activeState}Subtext`);
  const displayCardSub = cardSub !== `loader.${activeState}Subtext` ? cardSub : cfg.subtext;

  return (
    <div
      className={cn(
        "relative z-20 rounded-2xl border border-[var(--border)] bg-[#080D1A]/95 p-4 sm:p-5 shadow-xl transition-all",
        className
      )}
    >
      {/* Top Header / Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3.5 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-400/30">
              AI LOADER DEMO
            </span>
            <span className="text-xs font-bold text-white">DevNuby State Loader</span>
          </div>
          <p className="text-[11px] text-[var(--muted)] mt-0.5">
            Pilih status di bawah untuk melihat animasi berpikir, terminal tools, dan loading normal:
          </p>
        </div>

        {showTabs && (
          <div className="flex items-center gap-1.5 flex-wrap bg-black/40 p-1 rounded-xl border border-white/10 self-start sm:self-auto">
            {ORDERED_STATES.map((st) => {
              const isCurrent = st === activeState;
              return (
                <button
                  key={st}
                  type="button"
                  onClick={() => setActiveState(st)}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer",
                    isCurrent
                      ? "bg-cyan-500/30 text-cyan-200 border border-cyan-400/40 shadow-sm"
                      : "text-slate-300 hover:text-white hover:bg-white/5"
                  )}
                >
                  {LOADER_STATES[st].tabLabel}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Main Loader Stage (No Enclosing Box around character, generous headroom so antenna/waves never clip) */}
      <div className="rounded-xl bg-[#0B1325]/80 border border-white/10 pt-7 pb-6 px-5 flex flex-col items-center justify-center min-h-[185px] relative overflow-visible transition-colors">
        {/* Mascot (Body and Eyeballs follow cursor) */}
        <div
          ref={targetRef as React.RefObject<HTMLDivElement>}
          className="w-24 h-24 sm:w-28 sm:h-28 flex items-center justify-center relative overflow-visible"
        >
          <DevnubyLoaderMascot state={activeState} tracking={tracking} className="w-full h-full overflow-visible" />
        </div>

        {/* Dynamic Pulsing Shadow Under Mascot Body (subtly tracks body shift) */}
        <div
          className="dn-loader-shadow w-14 h-2.5 rounded-full bg-cyan-400/30 blur-[3px] -mt-2.5"
          style={{ transform: `translateX(${tracking.body.x * 0.75}px)` }}
        />

        {/* Status Badge & Description */}
        <div className="mt-3.5 text-center space-y-1">
          <div className="flex items-center justify-center gap-2">
            <span className="font-bold text-xs text-white">
              Dev<span className="text-cyan-300">Nuby</span>
            </span>
            <span className={cn("text-[10px] font-mono px-2 py-0.5 rounded-md border font-medium transition-all", cfg.badgeStyle)}>
              {displayCardBadge}
            </span>
          </div>
          <p className="text-[11px] text-slate-300/80 max-w-[42ch]">{displayCardSub}</p>
        </div>

        {/* Animated Progress Bar */}
        <div className="w-48 sm:w-56 h-1.5 rounded-full bg-white/10 overflow-hidden mt-3.5">
          <div
            className={cn(
              "w-full h-full bg-gradient-to-r dn-loader-progress-slide",
              cfg.progressClass
            )}
          />
        </div>

        {/* Footer Hint */}
        <span className="text-[10px] text-slate-400/70 mt-3 flex items-center gap-1 opacity-70">
          💡 Gunakan tab di atas untuk beralih mode • State tetap stabil saat di-hover/klik
        </span>
      </div>
    </div>
  );
}
