"use client";

import React, { useRef, useLayoutEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronRight, Lock, Sparkles } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";
import { useAccount } from "@/providers/account-provider";
import type { ModelOption, ReasoningLevel } from "@/types";

interface ModelSelectorProps {
  currentModelId: string;
  onModelChange: (modelId: string) => void;
  reasoningLevel: ReasoningLevel;
  onReasoningChange: (level: ReasoningLevel) => void;
}

const reasoningLabels: Record<ReasoningLevel, string> = {
  "0": "Mati",
  "1": "Rendah",
  "2": "Sedang",
  "3": "Tinggi",
  "4": "Maks",
};

export function ModelSelector({
  currentModelId,
  onModelChange,
  reasoningLevel,
  onReasoningChange,
}: ModelSelectorProps) {
  const { t } = useI18n();
  const router = useRouter();
  // Public catalog comes live from the DB (admin-managed); no static fallback
  const { models } = useAccount();
  const [view, setView] = useState<"quick" | "catalog">("quick");
  const [isOpen, setIsOpen] = useState(false);

  const currentModel = useMemo(() => {
    const found = models.find((m) => m.id === currentModelId && !m.isLocked);
    if (found) return found;
    return models.find((m) => !m.isLocked) ?? models[0] ?? null;
  }, [models, currentModelId]);

  const quickRef = useRef<HTMLDivElement>(null);
  const catalogRef = useRef<HTMLDivElement>(null);
  // Seeded with the quick view's natural height so the very first frame is
  // already correct (an "auto" height would expand to fit the taller catalog).
  const [trackHeight, setTrackHeight] = useState<number>(208);

  // Measure before the browser paints whenever view or model settings change.
  useLayoutEffect(() => {
    if (!isOpen) return;

    const el = view === "quick" ? quickRef.current : catalogRef.current;
    if (!el) return;

    const measure = () => {
      const h = el.offsetHeight;
      if (h > 0) setTrackHeight(h);
    };

    measure();

    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [isOpen, view, currentModelId, reasoningLevel]);

  function close() {
    setIsOpen(false);
    setView("quick");
    setTrackHeight(208);
  }

  function handleSelect(id: string) {
    onModelChange(id);
    close();
  }

  function handleLockedClick() {
    close();
    router.push("/plans");
  }

  const powerfulModels = models.filter((m) => m.category === "Powerful");
  const fastModels = models.filter((m) => m.category === "Fast");

  const isCatalog = view === "catalog";

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (open) setIsOpen(true);
        else close();
      }}
      side="top"
      align="end"
      className="w-[300px] p-0"
      trigger={
        <button
          type="button"
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-[10px] text-[13px] font-semibold text-[var(--ink)] hover:bg-[var(--hover)] transition-colors cursor-pointer"
        >
          <span>{currentModel?.shortName ?? t("model.noModels")}</span>
          <ChevronDown className="w-3.5 h-3.5 text-[var(--placeholder)]" />
        </button>
      }
    >
      {/* Outer clip container — height animates to match active panel */}
      <div
        className="overflow-hidden transition-[height] duration-300"
        style={{
          height: `${trackHeight}px`,
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        {/* Horizontal track: both panels side by side, slides left/right */}
        <div
          className="flex items-start transition-transform duration-300"
          style={{
            width: "200%",
            transform: isCatalog ? "translateX(-50%)" : "translateX(0)",
            transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {/* Panel 1: Quick view */}
          <div ref={quickRef} className="w-1/2 shrink-0 p-2.5 pb-3 space-y-2">
            <div className="px-1 py-1 text-xs font-semibold text-[var(--ink)]">
              {t("model.title")}
            </div>

            <button
              type="button"
              onClick={() => setView("catalog")}
              className="glass-hover flex items-center gap-2.5 w-full p-2.5 rounded-[6px] text-left cursor-pointer"
            >
              <ProviderLogo model={currentModel} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-[var(--ink)] truncate">
                  {currentModel?.fullName ?? t("model.noModels")}
                </span>
                <span className="block text-xs text-[var(--muted)] truncate">
                  {currentModel?.description ?? t("model.noModelsHint")}
                </span>
              </span>
              <ChevronRight className="w-4 h-4 text-[var(--placeholder)] shrink-0" />
            </button>

            <div className="p-3 rounded-[8px] bg-white/[0.04] border border-white/[0.05] space-y-3">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-[var(--ink)]">{t("model.reasoning")}</span>
                <span
                  key={reasoningLevel}
                  className={cn(
                    "typewriter-fade-in tabular-nums",
                    reasoningLevel === "4"
                      ? "reasoning-text-galaxy"
                      : "text-[var(--muted)]"
                  )}
                >
                  {reasoningLabels[reasoningLevel]}
                </span>
              </div>
              <ReasoningSlider
                value={reasoningLevel}
                onChange={onReasoningChange}
                label={t("model.reasoning")}
              />
            </div>
          </div>

          {/* Panel 2: Catalog view */}
          <div ref={catalogRef} className="w-1/2 shrink-0 p-2 space-y-2">
            <div className="flex items-center gap-2 px-1 py-1 border-b border-[var(--border)]">
              <button
                type="button"
                onClick={() => setView("quick")}
                className="glass-hover p-1 rounded-[4px] text-[var(--ink)] cursor-pointer"
                aria-label="Kembali"
              >
                <ChevronRight className="w-4 h-4 rotate-180" />
              </button>
              <span className="text-xs font-semibold text-[var(--ink)]">
                {t("model.selectModel")}
              </span>
            </div>

            <div className="max-h-[340px] overflow-y-auto">
              {models.length === 0 && (
                <p className="px-2 py-3 text-xs text-[var(--muted)]">{t("model.noModelsHint")}</p>
              )}
              {powerfulModels.length > 0 && (
                <p className="px-2 py-1 text-[11px] font-semibold text-[var(--placeholder)]">
                  {t("model.powerful")}
                </p>
              )}
              {powerfulModels.map((m) => (
                <ModelItem
                  key={m.id}
                  model={m}
                  selected={m.id === currentModelId}
                  onSelect={handleSelect}
                  onLockedClick={handleLockedClick}
                />
              ))}

              {fastModels.length > 0 && (
                <p className="px-2 py-1 mt-2 text-[11px] font-semibold text-[var(--placeholder)]">
                  {t("model.fast")}
                </p>
              )}
              {fastModels.map((m) => (
                <ModelItem
                  key={m.id}
                  model={m}
                  selected={m.id === currentModelId}
                  onSelect={handleSelect}
                  onLockedClick={handleLockedClick}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Popover>
  );
}

const REASONING_STEPS: ReasoningLevel[] = ["0", "1", "2", "3", "4"];
const MAX_STEP = REASONING_STEPS.length - 1;
// Thumb is 22px inside a 30px track, so its center sits 15px from either end.
const THUMB_INSET = 15;
const SPRING = "cubic-bezier(0.34, 1.4, 0.64, 1)";

// Fixed (not random) so every open looks the same and nothing jumps on re-render.
const FLOW_PARTICLES = [
  { top: 30, size: 2, duration: 1.4, delay: 0, opacity: 0.7 },
  { top: 62, size: 1.5, duration: 1.9, delay: 0.35, opacity: 0.45 },
  { top: 45, size: 2.5, duration: 1.2, delay: 0.8, opacity: 0.8 },
  { top: 72, size: 1.5, duration: 1.6, delay: 1.1, opacity: 0.5 },
  { top: 22, size: 1.5, duration: 2.1, delay: 0.55, opacity: 0.4 },
  { top: 52, size: 2, duration: 1.5, delay: 1.4, opacity: 0.65 },
  { top: 38, size: 1.5, duration: 1.8, delay: 0.2, opacity: 0.5 },
  { top: 66, size: 2, duration: 1.3, delay: 0.95, opacity: 0.6 },
];

function ReasoningSlider({
  value,
  onChange,
  label,
}: {
  value: ReasoningLevel;
  onChange: (level: ReasoningLevel) => void;
  label: string;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  // Continuous 0..1 position while dragging; null when resting on a step.
  const [dragPos, setDragPos] = useState<number | null>(null);

  const step = Number(value);
  const pos = dragPos ?? step / MAX_STEP;
  const dragging = dragPos !== null;
  const isMax = step === MAX_STEP;

  function posFromPointer(clientX: number) {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const usable = rect.width - THUMB_INSET * 2;
    return Math.min(1, Math.max(0, (clientX - rect.left - THUMB_INSET) / usable));
  }

  function commit(p: number) {
    const next = REASONING_STEPS[Math.round(p * MAX_STEP)];
    if (next !== value) onChange(next);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = posFromPointer(e.clientX);
    setDragPos(p);
    commit(p);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragging) return;
    const p = posFromPointer(e.clientX);
    setDragPos(p);
    commit(p);
  }

  function handlePointerUp() {
    setDragPos(null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    let next = step;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = step + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = step - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = MAX_STEP;
    else return;
    e.preventDefault();
    onChange(REASONING_STEPS[Math.min(MAX_STEP, Math.max(0, next))]);
  }

  // While dragging the thumb tracks the pointer 1:1; on release it springs to the step.
  const motion = dragging
    ? "none"
    : `left 420ms ${SPRING}, width 420ms ${SPRING}`;
  const offset = `calc(${THUMB_INSET}px + ${pos} * (100% - ${THUMB_INSET * 2}px))`;

  return (
    <div className="space-y-2 select-none">
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={MAX_STEP}
        aria-valuenow={step}
        aria-valuetext={reasoningLabels[value]}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        className="group relative h-[30px] rounded-full bg-white/[0.05] border border-white/[0.06] cursor-pointer touch-none outline-none focus-visible:ring-2 focus-visible:ring-white/20"
      >
        {/* Soft pulsing halo around the track at max */}
        <div
          aria-hidden
          className={cn(
            "reasoning-glow pointer-events-none absolute -inset-px rounded-full transition-opacity duration-700 ease-out",
            isMax ? "opacity-100" : "opacity-0"
          )}
        />

        {/* Fill — always reaches just past the thumb so it reads as one pill */}
        <div
          className="absolute inset-y-0 left-0 overflow-hidden rounded-full bg-gradient-to-r from-white/[0.05] to-white/[0.14] motion-reduce:!transition-none"
          style={{
            width: `calc(${offset} + ${THUMB_INSET}px)`,
            transition: motion,
          }}
        >
          {/* Galaxy nebula — crossfades over the monochrome fill at max */}
          <div
            aria-hidden
            className={cn(
              "reasoning-galaxy absolute inset-0 transition-opacity duration-700 ease-out",
              isMax ? "opacity-100" : "opacity-0"
            )}
          />

          {/* Particles flowing toward the thumb — only at max reasoning */}
          <div
            aria-hidden
            className={cn(
              "absolute inset-y-0 left-0 transition-opacity duration-500",
              isMax ? "opacity-100" : "opacity-0"
            )}
            style={{ right: THUMB_INSET * 2 }}
          >
            {FLOW_PARTICLES.map((p, i) => (
                <span
                  key={i}
                  className="reasoning-particle-lane"
                  style={
                    {
                      "--p-duration": `${p.duration}s`,
                      "--p-delay": `${p.delay}s`,
                      "--p-opacity": p.opacity,
                    } as React.CSSProperties
                  }
                >
                  <span
                    className="absolute left-0 rounded-full bg-white"
                    style={{
                      top: `${p.top}%`,
                      width: p.size * 3,
                      height: p.size,
                      marginTop: -p.size / 2,
                      boxShadow: `0 0 ${p.size * 3}px rgba(255,255,255,0.5)`,
                    }}
                  />
                </span>
              ))}
          </div>
        </div>

        {/* Step dots */}
        {REASONING_STEPS.map((s, i) => {
          const active = i <= step;
          return (
            <span
              key={s}
              className={cn(
                "absolute top-1/2 w-1 h-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-300",
                active ? "bg-white/40" : "bg-white/15"
              )}
              style={{
                left: `calc(${THUMB_INSET}px + ${i / MAX_STEP} * (100% - ${THUMB_INSET * 2}px))`,
              }}
            />
          );
        })}

        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 motion-reduce:!transition-none"
          style={{ left: offset, transition: motion }}
        >
          <div
            className={cn(
              "w-[22px] h-[22px] rounded-full bg-[var(--ink)] transition-[transform,box-shadow] duration-500 ease-out",
              isMax
                ? "shadow-[0_2px_8px_rgba(0,0,0,0.45),0_0_14px_rgba(196,181,253,0.7),0_0_0_1px_rgba(255,255,255,0.25)]"
                : "shadow-[0_2px_8px_rgba(0,0,0,0.45),0_0_0px_rgba(196,181,253,0),0_0_0_1px_rgba(255,255,255,0.08)]",
              dragging ? "scale-110" : "group-hover:scale-105"
            )}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Provider brand mark from /public/brand-logos, keyed by the admin-set
 * logoKey (falling back to the provider slug). Sits on a fixed white disc in
 * both themes because some marks (OpenAI, Grok) use currentColor, which an
 * <img> renders black. Falls back to the sparkle when there is no file.
 */
function ProviderLogo({ model }: { model: ModelOption | null }) {
  const key = model?.provider?.logoKey ?? model?.provider?.slug;
  const src = key ? `/brand-logos/${encodeURIComponent(key)}.svg` : null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (!src || failedSrc === src) {
    return (
      <span className="grid place-items-center w-6 h-6 rounded-full bg-[var(--accent)] text-[var(--accent-text)] shrink-0">
        <Sparkles className="w-3.5 h-3.5" />
      </span>
    );
  }

  return (
    <span className="grid place-items-center w-6 h-6 rounded-full bg-white ring-1 ring-black/[0.06] shrink-0 overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={model?.provider?.name ?? ""}
        width={14}
        height={14}
        loading="lazy"
        draggable={false}
        onError={() => setFailedSrc(src)}
        className="w-3.5 h-3.5 object-contain"
      />
    </span>
  );
}

function ModelItem({
  model,
  selected,
  onSelect,
  onLockedClick,
}: {
  model: ModelOption;
  selected: boolean;
  onSelect: (id: string) => void;
  onLockedClick: () => void;
}) {
  const isLocked = Boolean(model.isLocked);

  return (
    <button
      type="button"
      onClick={() => {
        if (isLocked) {
          onLockedClick();
        } else {
          onSelect(model.id);
        }
      }}
      className={cn(
        "flex items-center gap-2.5 w-full p-2 rounded-[6px] text-left transition-colors cursor-pointer group",
        isLocked
          ? "hover:bg-[var(--hover)] opacity-70 hover:opacity-100"
          : "glass-hover"
      )}
    >
      <ProviderLogo model={model} />
      <span className="flex-1 min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="block text-sm font-medium text-[var(--ink)] truncate">
            {model.fullName}
          </span>
          {isLocked && (
            <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold tracking-wider bg-white/[0.08] text-[var(--placeholder)] border border-white/[0.08]">
              PRO
            </span>
          )}
        </span>
        <span className="block text-xs text-[var(--muted)] truncate">
          {isLocked ? "Tersedia di paket Pro" : model.description}
        </span>
      </span>
      {isLocked ? (
        <Lock className="w-3.5 h-3.5 text-[var(--placeholder)] shrink-0 group-hover:text-[var(--ink)] transition-colors" />
      ) : selected ? (
        <Check className="w-4 h-4 text-[var(--accent)] shrink-0" />
      ) : null}
    </button>
  );
}
