"use client";

import React, { useEffect, useImperativeHandle, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { BARE_MASCOT_GROUND, DevnubyIcon, type MascotMood } from "@/components/brand/devnuby-logo";
import type { TypewriterState } from "./typewriter-headline";
import { cn } from "@/lib/cn";

const TICK_MS = 80;
/** Tick rate with reduced motion, where it never hops and only tracks its perch */
const STILL_TICK_MS = 500;
const HOP_MIN_MS = 620;
const HOP_MAX_MS = 1000;
/** Preferred minimum hop distance, so hops read as jumps and not shuffles */
const MIN_HOP_PX = 56;
/** Chance the mascot runs in front of the caret to push back on a given phrase */
const PUSH_CHANCE = 0.4;
/** Only worth pushing when this many characters are left (a hop lasts ~15 typed characters) */
const PUSH_MIN_REMAINING = 16;
/** It idles at least this long after landing before it may run off to push */
const PUSH_MIN_IDLE_MS = 5000;
const RELIEF_MS = 1300;
/** Expression while idling: both eyes big and round */
const IDLE_MOOD: MascotMood = "starry-kawaii";

/** How long it idles on each kind of spot before the next hop (ms) */
const REST_MS: Record<RestKind, [number, number]> = {
  headline: [6000, 9000],
  card: [7000, 11000],
  label: [5000, 8000],
  composer: [6000, 9000],
  // Beside the caret after a push: a short breather, then it leaves
  caret: [1400, 2000],
};

type RestKind = "headline" | "card" | "label" | "composer" | "caret";

/**
 * Where it stands. `x` is absolute for text lines (text changes length), `t` is a 0-1
 * fraction along a box's top edge (cards, composer)
 */
type Perch =
  | { kind: "headline"; x: number }
  | { kind: "label"; x: number }
  | { kind: "card"; index: number; t: number }
  | { kind: "composer"; t: number }
  | { kind: "caret" };

interface Spot {
  x: number;
  y: number;
}

interface Origin {
  left: number;
  top: number;
}

const noopSubscribe = () => () => {};
/** True on the client only (the portal target, document.body, doesn't exist during SSR) */
const useIsClient = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

/** Where the punch landed, relative to the card's top-left corner, plus the card size */
export interface PunchImpact {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PerchedMascotHandle {
  /**
   * Fly to quick-prompt card `index` and punch it (~1.75s). `onImpact` fires at the
   * moment of the hit; the promise resolves when the whole animation is over (right
   * away with reduced motion or when the card can't be found).
   */
  punch: (index: number, onImpact?: (impact: PunchImpact) => void) => Promise<void>;
}

type PunchPhase = "windup" | "fly" | "impact" | "recoil";

const PUNCH_WINDUP_MS = 250;
const PUNCH_FLY_MS = 450;
const PUNCH_IMPACT_MS = 160;
/** Resolve after the crack has spread: total stays under 2s */
const PUNCH_TOTAL_MS = 1750;

interface PerchedMascotProps {
  ref?: React.Ref<PerchedMascotHandle>;
  /**
   * The container the mascot roams in. Landing spots are its descendants marked
   * `data-perch="headline" | "caret" | "label" | "card"`, plus the chat composer
   * (`data-perch="composer"`, outside the stage). Positions are viewport-based
   * (`position: fixed`) so it can leave the scroll area to land on the composer.
   */
  stageRef: React.RefObject<HTMLElement | null>;
  typewriterRef: React.RefObject<TypewriterState | null>;
  /** True while it stands in front of the caret pushing back (the typewriter should slow down) */
  onPushingChange?: (pushing: boolean) => void;
  /** Rendered width in px (height follows the mascot's aspect ratio) */
  size?: number;
}

/**
 * The DevNuby mascot (without its tile) roaming the home screen: it hops between the
 * headline text, the quick-prompt cards, the section label and the chat composer,
 * idling (round eyes) a different amount of time on each. Dropping onto the composer
 * is a fall that shakes the cards like a small earthquake. On some phrases it runs in
 * front of the typewriter caret and strains against it, slowing the typing down, and
 * only lets go once the phrase is fully typed. When a card is clicked it flies over
 * and punches it (see `PerchedMascotHandle.punch`). Pauses while hovered; with
 * reduced motion it just stands still.
 */
export function PerchedMascot({ ref, stageRef, typewriterRef, onPushingChange, size = 44 }: PerchedMascotProps) {
  const height = (size * 54) / 48;
  const isClient = useIsClient();
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Spot | null>(null);
  const [hop, setHop] = useState({ id: 0, dir: "right" as "left" | "right", ms: 720, h: 40 });
  const [isHopping, setIsHopping] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isRelieved, setIsRelieved] = useState(false);
  const [mood, setMood] = useState<MascotMood>(IDLE_MOOD);
  // Hidden while the stage itself isn't laid out (e.g. chat area hidden by a fullscreen panel)
  const [isHidden, setIsHidden] = useState(false);
  // Follows scrolling instantly instead of easing after it
  const [isSnapping, setIsSnapping] = useState(false);

  const [punch, setPunch] = useState<{ phase: PunchPhase; dir: "left" | "right" } | null>(null);

  const hoveredRef = useRef(false);
  const onPushingChangeRef = useRef(onPushingChange);
  useEffect(() => {
    onPushingChangeRef.current = onPushingChange;
  });

  // The punch needs the state machine inside the effect below, which installs it here
  const punchRef = useRef<PerchedMascotHandle["punch"] | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      punch: (index, onImpact) => punchRef.current?.(index, onImpact) ?? Promise.resolve(),
    }),
    []
  );

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (fn: () => void, ms: number) => {
      const id = setTimeout(() => {
        timers.delete(id);
        fn();
      }, ms);
      timers.add(id);
    };

    let current: Spot | null = null;
    let perch: Perch | null = null;
    let mode: "rest" | "hopping" | "pushing" | "punching" = "rest";
    let hopEndsAt = 0;
    let landedAt = Date.now();
    let nextHopAt = Date.now() + 1500;
    // Per-phrase push decision
    let decidedIndex = -1;
    let wantsPush = false;

    const rand = (min: number, max: number) => min + Math.random() * (max - min);

    /** The mascot is `position: fixed`, so every spot is in viewport coordinates */
    const VIEWPORT: Origin = { left: 0, top: 0 };

    function stageBox() {
      const stage = stageRef.current;
      return stage ? { stage, box: VIEWPORT } : null;
    }

    /** Feet at `groundY` (viewport coordinates) → top-left of the mascot box */
    const standAt = (x: number, groundY: number): Spot => ({ x, y: groundY - height * BARE_MASCOT_GROUND });

    /** Horizontal range and ground line for standing on top of an inline text element */
    function textLine(el: Element | null, box: Origin) {
      const line = el?.getClientRects()[0];
      if (!el || !line || line.width < size * 0.6) return null;
      const fontSize = parseFloat(getComputedStyle(el).fontSize) || 16;
      return {
        minX: line.left - box.left - size * 0.15,
        maxX: Math.max(line.left - box.left - size * 0.15, line.right - box.left - size * 0.85),
        // Feet just below the line box top, roughly on the glyph tops
        ground: line.top - box.top + fontSize * 0.2,
      };
    }

    function cards(stage: HTMLElement) {
      return Array.from(stage.querySelectorAll<HTMLElement>('[data-perch="card"]'));
    }

    const composerEl = () => document.querySelector<HTMLElement>('[data-perch="composer"]');

    /** Standing range along the top edge of a box (card, composer) */
    function edgeRange(el: HTMLElement, box: Origin) {
      const r = el.getBoundingClientRect();
      return { minX: r.left - box.left + 10, maxX: r.right - box.left - size - 10, ground: r.top - box.top + 1 };
    }

    /** Earthquake when it crashes onto the composer: the cards rattle, scaled by the drop height */
    function quake(drop: number) {
      const stage = stageRef.current;
      if (!stage) return;
      const amp = Math.max(1.5, Math.min(drop / 70, 4.5));
      for (const el of cards(stage)) {
        const dir = Math.random() < 0.5 ? -1 : 1;
        const a = amp * (0.75 + Math.random() * 0.5);
        el.animate(
          [
            { transform: "translate(0, 0) rotate(0deg)" },
            { transform: `translate(${dir * a}px, ${-a * 0.6}px) rotate(${dir * a * 0.18}deg)` },
            { transform: `translate(${-dir * a * 0.8}px, ${a * 0.4}px) rotate(${-dir * a * 0.14}deg)` },
            { transform: `translate(${dir * a * 0.5}px, ${-a * 0.25}px) rotate(${dir * a * 0.08}deg)` },
            { transform: `translate(${-dir * a * 0.25}px, 0) rotate(0deg)` },
            { transform: "translate(0, 0) rotate(0deg)" },
          ],
          { duration: 460 + Math.random() * 120, delay: Math.random() * 60, easing: "ease-out" }
        );
      }
      composerEl()?.animate(
        [
          { transform: "translateY(0) scaleY(1)" },
          { transform: `translateY(${amp * 0.8}px) scaleY(0.985)` },
          { transform: "translateY(-1px) scaleY(1.004)" },
          { transform: "translateY(0) scaleY(1)" },
        ],
        { duration: 360, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" }
      );
    }

    /** Current position of a perch (layout may have changed since it landed) */
    function spotOf(p: Perch): Spot | null {
      const s = stageBox();
      if (!s) return null;
      const { stage, box } = s;
      if (p.kind === "caret") {
        const caret = stage.querySelector('[data-perch="caret"]');
        if (!caret) return null;
        const r = caret.getBoundingClientRect();
        // Right in front of the caret, feet on the line bottom, body pressed against it.
        // The offset makes up for the leftward lean while straining and the follow lag,
        // so the caret and the newest letter stay visible
        return standAt(r.right - box.left + size * 0.22, r.bottom - box.top + 2);
      }
      if (p.kind === "card" || p.kind === "composer") {
        const el = p.kind === "card" ? cards(stage)[p.index] : composerEl();
        if (!el) return null;
        const c = edgeRange(el, box);
        return standAt(c.minX + p.t * Math.max(0, c.maxX - c.minX), c.ground);
      }
      const line = textLine(stage.querySelector(`[data-perch="${p.kind}"]`), box);
      if (!line) return null;
      // Fell off the end of a line that got shorter (typewriter deleting)
      if (p.x > line.maxX + size * 0.3) return null;
      return standAt(p.x, line.ground);
    }

    /** A random landing spot somewhere else on the stage */
    function pickPerch(): Perch | null {
      const s = stageBox();
      if (!s) return null;
      const { stage, box } = s;
      const options: { weight: number; make: () => Perch | null }[] = [];

      for (const kind of ["headline", "label"] as const) {
        const line = textLine(stage.querySelector(`[data-perch="${kind}"]`), box);
        if (!line) continue;
        options.push({
          weight: kind === "headline" ? 3 : 1,
          make: () => {
            let x = rand(line.minX, line.maxX);
            for (let i = 0; i < 6 && current && Math.abs(x - current.x) < MIN_HOP_PX; i++) {
              x = rand(line.minX, line.maxX);
            }
            return { kind, x };
          },
        });
      }

      const cardEls = cards(stage);
      cardEls.forEach((_, index) => {
        if (perch?.kind === "card" && perch.index === index) return;
        options.push({ weight: 1.1, make: () => ({ kind: "card", index, t: Math.random() }) });
      });

      if (composerEl() && perch?.kind !== "composer") {
        options.push({ weight: 1, make: () => ({ kind: "composer", t: Math.random() }) });
      }

      const total = options.reduce((sum, o) => sum + o.weight, 0);
      let roll = Math.random() * total;
      for (const o of options) {
        roll -= o.weight;
        if (roll <= 0) return o.make();
      }
      return options[0]?.make() ?? null;
    }

    function setPushing(next: boolean) {
      setIsPushing(next);
      onPushingChangeRef.current?.(next);
    }

    function place(spot: Spot) {
      current = spot;
      setPos(spot);
    }

    function hopTo(target: Perch) {
      const spot = spotOf(target);
      if (!spot) return false;
      const from = current ?? spot;
      const dist = Math.hypot(spot.x - from.x, spot.y - from.y);
      const drop = Math.max(0, spot.y - from.y);
      const climb = Math.max(0, from.y - spot.y);
      // Onto the composer it's a fall: small take-off, then a long drop. Otherwise longer
      // hops take longer and arc higher, and climbing up gets extra lift
      const isFall = target.kind === "composer" && drop > 60;
      const ms = isFall
        ? Math.round(Math.min(950, HOP_MIN_MS + dist * 0.55))
        : Math.round(Math.min(HOP_MAX_MS, HOP_MIN_MS + dist * 0.9));
      const h = isFall
        ? Math.round(20 + Math.min(dist * 0.04, 14))
        : Math.round(28 + Math.min(dist * 0.16, 44) + Math.min(climb * 0.25, 30));
      const now = Date.now();

      setHop((prev) => ({ id: prev.id + 1, dir: spot.x >= from.x ? "right" : "left", ms, h }));
      setIsHopping(true);
      later(() => setIsHopping(false), ms);
      hopEndsAt = now + ms;
      mode = "hopping";
      perch = target;
      place(spot);

      // Card squishes a little under the landing
      if (target.kind === "card") {
        const el = stageRef.current ? cards(stageRef.current)[target.index] : null;
        later(() => {
          el?.animate(
            [
              { transform: "translateY(0) scaleY(1)" },
              { transform: "translateY(2px) scaleY(0.985)" },
              { transform: "translateY(0) scaleY(1)" },
            ],
            { duration: 280, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" }
          );
        }, ms * 0.74);
      }
      if (target.kind === "composer") later(() => quake(drop), ms * 0.74);
      // Typing slows as soon as it leaps at the caret, so the caret hasn't run far
      // ahead by the time it lands (the straining face only starts on landing)
      if (target.kind === "caret") onPushingChangeRef.current?.(true);
      return true;
    }

    function land() {
      if (!perch) return;
      if (perch.kind === "caret") {
        const tw = typewriterRef.current;
        // The phrase may have finished while it was in the air
        if (tw?.phase === "typing" && tw.typed < tw.total) {
          mode = "pushing";
          setPushing(true);
          return;
        }
        onPushingChangeRef.current?.(false);
      }
      mode = "rest";
      landedAt = Date.now();
      const [min, max] = REST_MS[perch.kind];
      nextHopAt = landedAt + rand(min, max);
    }

    function release() {
      setPushing(false);
      mode = "rest";
      setIsRelieved(true);
      setMood("happy-chevrons");
      later(() => setIsRelieved(false), 620);
      later(() => setMood(IDLE_MOOD), RELIEF_MS);
      const [min, max] = REST_MS.caret;
      nextHopAt = Date.now() + rand(min, max);
    }

    function tick() {
      // Background tab: skip the layout reads entirely
      if (document.hidden) return;
      const now = Date.now();
      const tw = typewriterRef.current;

      const stageRect = stageRef.current?.getBoundingClientRect();
      const hidden = !stageRect || stageRect.width === 0;
      setIsHidden(hidden);
      if (hidden || mode === "punching") return;

      if (!current) {
        // The headline starts empty, so it first waits beside the caret
        const spot = spotOf({ kind: "caret" });
        if (!spot) return;
        perch = { kind: "caret" };
        place(spot);
        return;
      }

      if (mode === "hopping") {
        if (now < hopEndsAt) return;
        land();
      }

      if (mode === "pushing") {
        if (!tw || tw.phase !== "typing" || tw.typed >= tw.total) {
          release();
          return;
        }
        const spot = spotOf({ kind: "caret" });
        if (spot && (Math.abs(spot.x - current.x) > 0.3 || Math.abs(spot.y - current.y) > 0.3)) place(spot);
        return;
      }

      // Resting: stay glued to the perch as the layout shifts
      const spot = perch ? spotOf(perch) : null;
      if (!spot) {
        // Its spot vanished (text deleted under it): hop somewhere else right away
        if (!reducedMotion) {
          const next = pickPerch();
          if (next) hopTo(next);
        }
        return;
      }
      if (Math.abs(spot.x - current.x) > 0.5 || Math.abs(spot.y - current.y) > 0.5) place(spot);

      if (reducedMotion || hoveredRef.current) return;

      // Once per phrase, maybe run in front of the caret to push back
      if (tw && tw.index !== decidedIndex && tw.phase === "typing") {
        decidedIndex = tw.index;
        wantsPush = Math.random() < PUSH_CHANCE;
      }
      if (
        wantsPush &&
        now - landedAt >= PUSH_MIN_IDLE_MS &&
        tw?.phase === "typing" &&
        tw.index === decidedIndex &&
        tw.total - tw.typed >= PUSH_MIN_REMAINING
      ) {
        wantsPush = false;
        if (hopTo({ kind: "caret" })) return;
      }

      if (now >= nextHopAt) {
        const next = pickPerch();
        if (!next || !hopTo(next)) nextHopAt = now + 1000;
      }
    }

    /**
     * Fly to a card and punch it: windup → fly → impact (card pressed in, stage jolts,
     * other cards rattle) → recoil with a satisfied face. Takes over from whatever it
     * was doing, including a push against the caret.
     */
    punchRef.current = (index, onImpact) =>
      new Promise<void>((resolve) => {
        const stage = stageRef.current;
        const card = stage ? cards(stage)[index] : null;
        if (!stage || !card || !current || reducedMotion || mode === "punching") {
          resolve();
          return;
        }

        mode = "punching";
        setPushing(false);
        setIsHopping(false);
        setIsRelieved(false);

        const r = card.getBoundingClientRect();
        // Somewhere around the middle of the card, not dead center every time
        const hitX = r.width * rand(0.32, 0.68);
        const hitY = r.height * rand(0.38, 0.62);
        const dir: "left" | "right" = r.left + hitX >= current.x + size / 2 ? "right" : "left";

        setPunch({ phase: "windup", dir });
        setMood("smug-dev");

        later(() => {
          setPunch({ phase: "fly", dir });
          // Body centered on the hit point
          place({ x: r.left + hitX - size / 2, y: r.top + hitY - height * 0.55 });
        }, PUNCH_WINDUP_MS);

        later(() => {
          setPunch({ phase: "impact", dir });
          onImpact?.({ x: hitX, y: hitY, width: r.width, height: r.height });
          card.animate(
            [
              { transform: "scale(1) translateY(0)" },
              { transform: "scale(0.965) translateY(2px)" },
              { transform: "scale(0.985) translateY(1px)" },
            ],
            { duration: 260, easing: "cubic-bezier(0.2, 0.9, 0.3, 1)", fill: "forwards" }
          );
          stage.animate(
            [
              { transform: "translate(0, 0)" },
              { transform: "translate(-3px, 2px)" },
              { transform: "translate(3px, -2px)" },
              { transform: "translate(-2px, 1px)" },
              { transform: "translate(1px, 0)" },
              { transform: "translate(0, 0)" },
            ],
            { duration: 280, easing: "ease-out" }
          );
          for (const other of cards(stage)) {
            if (other === card) continue;
            const a = rand(1, 2.2) * (Math.random() < 0.5 ? -1 : 1);
            other.animate(
              [
                { transform: "translate(0, 0) rotate(0deg)" },
                { transform: `translate(${a}px, ${-Math.abs(a) * 0.5}px) rotate(${a * 0.15}deg)` },
                { transform: `translate(${-a * 0.6}px, 0) rotate(${-a * 0.1}deg)` },
                { transform: "translate(0, 0) rotate(0deg)" },
              ],
              { duration: 360, delay: rand(0, 50), easing: "ease-out" }
            );
          }
        }, PUNCH_WINDUP_MS + PUNCH_FLY_MS);

        later(() => {
          setPunch({ phase: "recoil", dir });
          setMood("happy-chevrons");
          if (current) place({ x: current.x + (dir === "right" ? -22 : 22), y: current.y - 30 });
        }, PUNCH_WINDUP_MS + PUNCH_FLY_MS + PUNCH_IMPACT_MS);

        later(resolve, PUNCH_TOTAL_MS);
        later(() => {
          // Reset so tick() can move it again after the punch
          mode = "rest";
          perch = null;
          setPunch(null);
          setMood(IDLE_MOOD);
          const [min, max] = REST_MS.headline;
          nextHopAt = Date.now() + rand(min, max);
        }, PUNCH_TOTAL_MS);
      });

    // Scrolling moves every spot: stick to the perch right away, without easing
    let snapTimer: ReturnType<typeof setTimeout> | null = null;
    function onScroll() {
      if (mode !== "rest" && mode !== "pushing") return;
      const spot = perch ? spotOf(perch) : null;
      if (!spot) return;
      setIsSnapping(true);
      place(spot);
      if (snapTimer) clearTimeout(snapTimer);
      snapTimer = setTimeout(() => setIsSnapping(false), 150);
    }

    tick();
    // Standing still (reduced motion) only needs to follow layout changes, not animate
    const interval = setInterval(tick, reducedMotion ? STILL_TICK_MS : TICK_MS);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      punchRef.current = null;
      clearInterval(interval);
      timers.forEach(clearTimeout);
      if (snapTimer) clearTimeout(snapTimer);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      onPushingChangeRef.current?.(false);
    };
  }, [stageRef, typewriterRef, size, height]);

  if (!isClient) return null;

  // Portaled to <body>: an ancestor with a transform/filter would otherwise become the
  // containing block of `position: fixed` and offset every viewport coordinate
  return createPortal(
    <div
      ref={rootRef}
      className={cn(
        "dn-perch",
        isPushing && "is-pushing",
        isSnapping && "is-snapping",
        punch?.phase === "fly" && "is-flying",
        punch?.phase === "recoil" && "is-recoiling"
      )}
      style={
        {
          // Inline so the mascot stays positioned even if perched-mascot.css
          // hasn't been picked up yet (new file during dev HMR)
          position: "fixed",
          left: 0,
          top: 0,
          zIndex: 30,
          width: size,
          height,
          opacity: pos && !isHidden ? 1 : 0,
          pointerEvents: isHidden ? "none" : undefined,
          transform: pos ? `translate(${pos.x}px, ${pos.y}px)` : undefined,
          "--hop-ms": `${hop.ms}ms`,
          "--hop-h": `${hop.h}px`,
        } as React.CSSProperties
      }
      onMouseEnter={() => (hoveredRef.current = true)}
      onMouseLeave={() => (hoveredRef.current = false)}
    >
      <div key={`hop-${hop.id}`} className={cn("dn-perch-hop", isHopping && "is-hopping")}>
        <div
          className={cn(
            "dn-perch-body",
            isHopping && (hop.dir === "left" ? "is-hopping-left" : "is-hopping-right"),
            !isHopping && isRelieved && "is-relieved",
            punch && `is-${punch.phase}`,
            punch?.dir === "left" && "is-left"
          )}
        >
          <DevnubyIcon
            bare
            // Gritted teeth while charging in and on the hit
            struggling={isPushing || punch?.phase === "fly" || punch?.phase === "impact"}
            mood={mood}
            className="block w-full h-auto"
          />
        </div>
      </div>
      {punch ? (
        <svg
          viewBox="0 0 24 20"
          aria-hidden="true"
          className={cn("dn-fist", `is-${punch.phase}`, punch.dir === "left" && "is-left")}
        >
          <defs>
            <linearGradient id="dn-fist-grad" x1="2" y1="2" x2="22" y2="18" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#ECFEFF" />
              <stop offset="0.55" stopColor="#A5F3FC" />
              <stop offset="1" stopColor="#818CF8" />
            </linearGradient>
          </defs>
          {/* Rounded mitten fist: palm + knuckles + thumb */}
          <rect x="2" y="3" width="17" height="14" rx="6" fill="url(#dn-fist-grad)" stroke="#4338CA" strokeWidth="1.2" />
          <path d="M14.5 5.2V9.6M10.8 4.6V9.4M7.2 5.2V9.6" stroke="#4338CA" strokeWidth="1.1" strokeLinecap="round" opacity="0.7" />
          <path d="M4 12.2C6.4 13.6 9.6 13.6 12 12.2" stroke="#4338CA" strokeWidth="1.2" strokeLinecap="round" />
          <path d="M19.5 7.5L22.5 6M19.8 10.5L23 10.5M19.5 13.5L22.5 15" stroke="#FDE68A" strokeWidth="1.3" strokeLinecap="round" opacity={punch.phase === "impact" ? 1 : 0} />
        </svg>
      ) : null}
    </div>,
    document.body
  );
}
