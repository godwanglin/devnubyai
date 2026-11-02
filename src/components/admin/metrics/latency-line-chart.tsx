"use client";

import React from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
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

export function LatencyLineChart({ data }: { data: TimeSeriesDataPoint[] }) {
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
          {t("admin.metrics.charts.latencyTitle")}
        </h3>
        <p className="text-xs text-[var(--muted)]">
          {t("admin.metrics.charts.latencySubtitle")}
        </p>
      </div>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
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
              tickFormatter={(v) => `${v}ms`}
            />
            <Tooltip content={<DevnubyChartTooltip />} />
            <Legend
              verticalAlign="top"
              align="right"
              iconType="circle"
              wrapperStyle={{ paddingBottom: "10px", fontSize: "11px" }}
            />
            <Line
              type="monotone"
              name="Rata-rata Latensi (ms)"
              dataKey="avgLatencyMs"
              stroke="#f59e0b"
              strokeWidth={2}
              dot={{ r: 3, fill: "#f59e0b" }}
              activeDot={{ r: 5 }}
            />
            <Line
              type="monotone"
              name="Time to First Token (TTFT ms)"
              dataKey="avgTtftMs"
              stroke="#10b981"
              strokeWidth={2}
              dot={{ r: 3, fill: "#10b981" }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
