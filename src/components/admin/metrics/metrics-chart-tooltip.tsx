"use client";

import React from "react";

export interface CustomTooltipItem {
  name?: string;
  value?: number | string;
  color?: string;
  unit?: string;
}

export function DevnubyChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number | string;
    color?: string;
    dataKey?: string;
  }>;
  label?: string;
}) {
  if (!active || !payload || payload.length === 0) return null;

  return (
    <div className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)]/95 backdrop-blur-[6px] px-3.5 py-2.5 shadow-xl text-xs z-50 min-w-[140px]">
      {label && (
        <p className="font-semibold text-[var(--ink)] mb-1.5 pb-1 border-b border-[var(--divider)]">
          {label}
        </p>
      )}
      <div className="space-y-1">
        {payload.map((entry, idx) => {
          const val = typeof entry.value === "number" ? entry.value.toLocaleString() : entry.value;
          return (
            <div key={`${entry.name || idx}`} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: entry.color || "var(--accent)" }}
                />
                <span className="text-[var(--muted)] truncate">{entry.name}</span>
              </div>
              <span className="font-mono font-medium text-[var(--ink)] tabular-nums shrink-0">
                {val}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
