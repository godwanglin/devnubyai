"use client";

import React from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
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

export function TrafficAreaChart({ data }: { data: TimeSeriesDataPoint[] }) {
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
          {t("admin.metrics.charts.trafficTitle")}
        </h3>
        <p className="text-xs text-[var(--muted)]">
          {t("admin.metrics.charts.trafficSubtitle")}
        </p>
      </div>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="gradSuccess" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="gradFallback" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.0} />
              </linearGradient>
              <linearGradient id="gradFailed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.0} />
              </linearGradient>
            </defs>
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
              allowDecimals={false}
            />
            <Tooltip content={<DevnubyChartTooltip />} />
            <Legend
              verticalAlign="top"
              align="right"
              iconType="circle"
              wrapperStyle={{ paddingBottom: "10px", fontSize: "11px" }}
            />
            <Area
              type="monotone"
              name="Sukses"
              dataKey="successfulRequests"
              stroke="#8b5cf6"
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#gradSuccess)"
            />
            <Area
              type="monotone"
              name="Fallback"
              dataKey="fallbackRequests"
              stroke="#f59e0b"
              strokeWidth={1.5}
              fillOpacity={1}
              fill="url(#gradFallback)"
            />
            <Area
              type="monotone"
              name="Gagal"
              dataKey="failedRequests"
              stroke="#f43f5e"
              strokeWidth={1.5}
              fillOpacity={1}
              fill="url(#gradFailed)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
