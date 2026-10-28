"use client";

import React, { useRef, useEffect, useLayoutEffect, useState, useMemo } from "react";
import { Check, ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { useI18n } from "@/providers/i18n-provider";
import modelsData from "@/data/models.json";
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
  const [view, setView] = useState<"quick" | "catalog">("quick");
  const [isOpen, setIsOpen] = useState(false);

  const models = modelsData as ModelOption[];
  const currentModel = useMemo(
    () => models.find((m) => m.id === currentModelId) || models[0],
    [models, currentModelId]
  );

  const quickRef = useRef<HTMLDivElement>(null);
  const catalogRef = useRef<HTMLDivElement>(null);
  // Seeded with the quick view's natural height so the very first frame is
  // already correct (an "auto" height would expand to fit the taller catalog).
  const [trackHeight, setTrackHeight] = useState<number>(208);

  const useIsomorphicLayoutEffect =
    typeof window !== "undefined" ? useLayoutEffect : useEffect;

  // Measure before the browser paints whenever view or model settings change.
  useIsomorphicLayoutEffect(() => {
    if (!isOpen) {
      setView("quick");
      setTrackHeight(208);
      return;
    }

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

  function handleSelect(id: string) {
    onModelChange(id);
    setIsOpen(false);
    setView("quick");
  }

  const powerfulModels = models.filter((m) => m.category === "Powerful");
  const fastModels = models.filter((m) => m.category === "Fast");

  const isCatalog = view === "catalog";

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) setView("quick");
      }}
      side="top"
      align="end"
      className="w-[300px] p-0"
      trigger={
        <button
          type="button"
          className="inline-flex items-center gap-1 px-2 py-1.5 rounded-[10px] text-[13px] font-semibold text-[var(--ink)] hover:bg-[var(--hover)] transition-colors cursor-pointer"
        >
          <span>{currentModel.shortName}</span>
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
              <span className="grid place-items-center w-6 h-6 rounded-full bg-[var(--accent)] text-[var(--accent-text)] shrink-0">
                <Sparkles className="w-3.5 h-3.5" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold text-[var(--ink)] truncate">
                  {currentModel.fullName}
                </span>
                <span className="block text-xs text-[var(--muted)] truncate">
                  {currentModel.description}
                </span>
              </span>
              <ChevronRight className="w-4 h-4 text-[var(--placeholder)] shrink-0" />
            </button>

            <div className="p-2.5 rounded-[6px] bg-white/[0.04] border border-white/[0.05] space-y-2">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-[var(--ink)]">{t("model.reasoning")}</span>
                <span className="text-[var(--muted)]">
                  {reasoningLabels[reasoningLevel]}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="4"
                step="1"
                value={reasoningLevel}
                onChange={(e) => onReasoningChange(e.target.value as ReasoningLevel)}
                className="w-full accent-[var(--accent)] cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-[var(--placeholder)]">
                <span>0</span><span>1</span><span>2</span><span>3</span><span>4</span>
              </div>
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
              <p className="px-2 py-1 text-[11px] font-semibold text-[var(--placeholder)]">
                {t("model.powerful")}
              </p>
              {powerfulModels.map((m) => (
                <ModelItem
                  key={m.id}
                  model={m}
                  selected={m.id === currentModelId}
                  onSelect={handleSelect}
                />
              ))}

              <p className="px-2 py-1 mt-2 text-[11px] font-semibold text-[var(--placeholder)]">
                {t("model.fast")}
              </p>
              {fastModels.map((m) => (
                <ModelItem
                  key={m.id}
                  model={m}
                  selected={m.id === currentModelId}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Popover>
  );
}

function ModelItem({
  model,
  selected,
  onSelect,
}: {
  model: ModelOption;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(model.id)}
      className="glass-hover flex items-center gap-2.5 w-full p-2 rounded-[6px] text-left cursor-pointer"
    >
      <span className="grid place-items-center w-6 h-6 rounded-full bg-[var(--accent)] text-[var(--accent-text)] shrink-0">
        <Sparkles className="w-3.5 h-3.5" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-medium text-[var(--ink)]">
          {model.fullName}
        </span>
        <span className="block text-xs text-[var(--muted)] truncate">
          {model.description}
        </span>
      </span>
      {selected && <Check className="w-4 h-4 text-[var(--accent)] shrink-0" />}
    </button>
  );
}
