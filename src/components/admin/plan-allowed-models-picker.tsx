"use client";

import React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export interface ModelItem {
  id: string;
  publicId: string;
  displayName: string;
  category: string;
  provider: { name: string };
}

interface PlanAllowedModelsPickerProps {
  allModels: ModelItem[];
  selectedModelIds: string[];
  onChange: (ids: string[]) => void;
}

export function PlanAllowedModelsPicker({
  allModels,
  selectedModelIds,
  onChange,
}: PlanAllowedModelsPickerProps) {
  function selectAll() {
    onChange(allModels.map((m) => m.id));
  }

  function clearAll() {
    onChange([]);
  }

  function toggle(id: string) {
    if (selectedModelIds.includes(id)) {
      onChange(selectedModelIds.filter((m) => m !== id));
    } else {
      onChange([...selectedModelIds, id]);
    }
  }

  return (
    <div className="border-t border-[var(--border)] pt-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
          Allowed Catalog Models ({selectedModelIds.length}/{allModels.length})
        </h4>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={selectAll}
            className="text-xs text-[var(--primary)] hover:underline cursor-pointer"
          >
            Select All
          </button>
          <span className="text-xs text-[var(--muted)]">•</span>
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-[var(--muted)] hover:underline cursor-pointer"
          >
            Clear All
          </button>
        </div>
      </div>

      <div className="mt-3 grid max-h-48 grid-cols-2 gap-2 overflow-y-auto rounded-[8px] border border-[var(--border)] p-3">
        {allModels.map((m) => {
          const selected = selectedModelIds.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => toggle(m.id)}
              className={cn(
                "flex items-center justify-between rounded-[6px] border p-2 text-left text-xs transition-colors cursor-pointer",
                selected
                  ? "border-[var(--primary)] bg-[var(--primary)]/5 text-[var(--primary)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--muted)]"
              )}
            >
              <div>
                <div className="font-medium text-[var(--ink)]">{m.displayName}</div>
                <div className="text-[10px] text-[var(--muted)] font-mono">{m.publicId}</div>
              </div>
              {selected && <Check className="h-4 w-4 shrink-0 text-[var(--primary)]" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
