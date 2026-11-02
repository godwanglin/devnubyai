"use client";

import React from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { useI18n } from "@/providers/i18n-provider";
import { useMounted } from "@/hooks/use-mounted";
import { DevnubyChartTooltip } from "./metrics-chart-tooltip";
import type { TimeSeriesDataPoint } from "@/lib/metrics/types";

function formatTokens(val: number): string {
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(0)}K`;
  return String(val);
}

export function TokenUsageChart({ data }: { data: TimeSeriesDataPoint[] }) {
  const { t } = useI18n();
  const mounted = useMounted();

  if (!mounted) {
    return (
      <div className="h-72 w-full rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-4 flex items-center justify-center text-xs text-[var(--muted)] animate-pulse">
        Memuat grafik...
      </div>
    );
  }

  return (
    <div className="p-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] flex flex-col justify-between">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-[var(--ink)]">
          {t("admin.metrics.charts.tokenTitle")}
        </h3>
        <p className="text-xs text-[var(--muted)]">
          {t("admin.metrics.charts.tokenSubtitle")}
        </p>
      </div>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
            />
            <YAxis
              tickLine={false}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              tickFormatter={formatTokens}
            />
            <Tooltip content={<DevnubyChartTooltip />} />
            <Legend
              verticalAlign="top"
              align="right"
              iconType="circle"
              wrapperStyle={{ paddingBottom: "10px", fontSize: "11px" }}
            />
            <Bar
              name="Prompt (Input)"
              dataKey="promptTokens"
              stackId="tokens"
              fill="#06b6d4"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              name="Completion (Output)"
              dataKey="completionTokens"
              stackId="tokens"
              fill="#6366f1"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
