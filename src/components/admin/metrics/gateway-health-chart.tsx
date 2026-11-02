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
import type { GatewayMetric } from "@/lib/metrics/types";

export function GatewayHealthChart({ data }: { data: GatewayMetric[] }) {
  const { t } = useI18n();
  const mounted = useMounted();

  if (!mounted) {
    return (
      <div className="h-72 w-full rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-4 flex items-center justify-center text-xs text-[var(--muted)] animate-pulse">
        Memuat grafik...
      </div>
    );
  }

  const chartData = data.map((g) => ({
    name: g.name,
    requests: g.requestCount,
    success: g.successCount,
    fallback: g.fallbackCount,
    error: g.errorCount,
    latency: g.avgLatencyMs,
    successRate: g.successRatePct,
  }));

  return (
    <div className="p-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] flex flex-col justify-between">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-[var(--ink)]">
          {t("admin.metrics.charts.gatewayTitle")}
        </h3>
        <p className="text-xs text-[var(--muted)]">
          {t("admin.metrics.charts.gatewaySubtitle")}
        </p>
      </div>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="name"
              tickLine={false}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
            />
            <YAxis
              tickLine={false}
              axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              allowDecimals={false}
            />
            <Tooltip content={<DevnubyChartTooltip />} />
            <Legend
              verticalAlign="top"
              align="right"
              iconType="circle"
              wrapperStyle={{ paddingBottom: "10px", fontSize: "11px" }}
            />
            <Bar
              name="Sukses"
              dataKey="success"
              fill="#10b981"
              radius={[4, 4, 0, 0]}
            />
            <Bar
              name="Fallback"
              dataKey="fallback"
              fill="#f59e0b"
              radius={[4, 4, 0, 0]}
            />
            <Bar
              name="Error"
              dataKey="error"
              fill="#ef4444"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
