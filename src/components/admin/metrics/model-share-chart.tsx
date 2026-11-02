"use client";

import React from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { useI18n } from "@/providers/i18n-provider";
import { useMounted } from "@/hooks/use-mounted";
import type { ModelUsageMetric } from "@/lib/metrics/types";

const COLORS = [
  "#8b5cf6", // Violet
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#6366f1", // Indigo
];

export function ModelShareChart({ data }: { data: ModelUsageMetric[] }) {
  const { t } = useI18n();
  const mounted = useMounted();

  if (!mounted) {
    return (
      <div className="h-72 w-full rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-4 flex items-center justify-center text-xs text-[var(--muted)] animate-pulse">
        Memuat grafik...
      </div>
    );
  }

  const chartData = data.map((m) => ({
    name: m.modelName,
    value: m.requestCount,
    share: m.requestSharePct,
    tokens: m.totalTokens,
  }));

  return (
    <div className="p-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] flex flex-col justify-between">
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-[var(--ink)]">
          {t("admin.metrics.charts.modelShareTitle")}
        </h3>
        <p className="text-xs text-[var(--muted)]">
          {t("admin.metrics.charts.modelShareSubtitle")}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 py-2">
        <div className="h-48 w-48 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="value"
                nameKey="name"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={3}
                stroke="var(--panel)"
                strokeWidth={2}
              >
                {chartData.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null;
                  const item = payload[0];
                  const payloadData = item.payload as { name: string; value: number; share: number };
                  return (
                    <div className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)]/95 backdrop-blur-[6px] px-3 py-2 shadow-xl text-xs z-50">
                      <p className="font-semibold text-[var(--ink)]">{payloadData.name}</p>
                      <div className="mt-1 flex items-center justify-between gap-4 text-[var(--muted)]">
                        <span>Permintaan:</span>
                        <span className="font-mono text-[var(--ink)] font-medium">
                          {payloadData.value.toLocaleString()} ({payloadData.share}%)
                        </span>
                      </div>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend list */}
        <div className="flex-1 w-full space-y-1.5 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
          {chartData.map((item, idx) => (
            <div
              key={item.name}
              className="flex items-center justify-between gap-2 text-xs py-1 px-2 rounded-[6px] hover:bg-[var(--hover)] transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                />
                <span className="truncate text-[var(--ink)] font-medium">{item.name}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 font-mono text-[11px]">
                <span className="text-[var(--muted)]">{item.value.toLocaleString()} req</span>
                <span className="px-1.5 py-0.5 rounded bg-[var(--hover)] font-semibold text-[var(--ink)]">
                  {item.share}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
