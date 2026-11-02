"use client";

import React from "react";
import { ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useI18n } from "@/providers/i18n-provider";
import { useMounted } from "@/hooks/use-mounted";
import { DevnubyChartTooltip } from "./metrics-chart-tooltip";
import type { PlanDistributionMetric, RevenueDataPoint } from "@/lib/metrics/types";

const PLAN_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b", "#ec4899"];

function formatCurrency(val: number): string {
  if (val >= 1_000_000) return `Rp ${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `Rp ${(val / 1_000).toFixed(0)}K`;
  return `Rp ${val}`;
}

export function BusinessMetricsCard({
  plans,
  revenue,
}: {
  plans: PlanDistributionMetric[];
  revenue: RevenueDataPoint[];
}) {
  const { t } = useI18n();
  const mounted = useMounted();

  if (!mounted) {
    return (
      <div className="h-72 w-full rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-4 flex items-center justify-center text-xs text-[var(--muted)] animate-pulse">
        Memuat metrik bisnis...
      </div>
    );
  }

  const planChartData = plans.map((p) => ({
    name: p.planName,
    value: p.userCount,
    percentage: p.percentage,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* 1. Plans Distribution Donut */}
      <div className="p-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] flex flex-col justify-between">
        <div className="mb-2">
          <h3 className="text-sm font-semibold text-[var(--ink)]">
            {t("admin.metrics.charts.plansTitle")}
          </h3>
          <p className="text-xs text-[var(--muted)]">
            {t("admin.metrics.charts.plansSubtitle")}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 py-2">
          <div className="h-44 w-44 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={planChartData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={75}
                  paddingAngle={3}
                  stroke="var(--panel)"
                  strokeWidth={2}
                >
                  {planChartData.map((_, index) => (
                    <Cell key={`plan-cell-${index}`} fill={PLAN_COLORS[index % PLAN_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || !payload.length) return null;
                    const item = payload[0];
                    const p = item.payload as { name: string; value: number; percentage: number };
                    return (
                      <div className="rounded-[10px] border border-[var(--border)] bg-[var(--panel)]/95 backdrop-blur-[6px] px-3 py-2 shadow-xl text-xs z-50">
                        <p className="font-semibold text-[var(--ink)]">{p.name}</p>
                        <p className="text-[var(--muted)] mt-0.5">
                          {p.value} pengguna ({p.percentage}%)
                        </p>
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="flex-1 w-full space-y-1.5 max-h-44 overflow-y-auto pr-1 scrollbar-thin">
            {plans.map((p, idx) => (
              <div
                key={p.planId}
                className="flex items-center justify-between text-xs py-1 px-2 rounded-[6px] hover:bg-[var(--hover)] transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: PLAN_COLORS[idx % PLAN_COLORS.length] }}
                  />
                  <span className="truncate font-medium text-[var(--ink)]">{p.planName}</span>
                </div>
                <div className="flex items-center gap-2 font-mono text-[11px] shrink-0">
                  <span className="text-[var(--muted)]">{p.userCount} users</span>
                  <span className="px-1.5 py-0.5 rounded bg-[var(--hover)] font-semibold text-[var(--ink)]">
                    {p.percentage}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Revenue History */}
      <div className="p-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] flex flex-col justify-between">
        <div className="mb-2">
          <h3 className="text-sm font-semibold text-[var(--ink)]">
            {t("admin.metrics.charts.revenueTitle")}
          </h3>
          <p className="text-xs text-[var(--muted)]">
            {t("admin.metrics.charts.revenueSubtitle")}
          </p>
        </div>

        <div className="h-52 w-full">
          {revenue.length === 0 ? (
            <div className="h-full flex items-center justify-center text-xs text-[var(--muted)]">
              Belum ada transaksi pembayaran lunas pada rentang waktu ini.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={revenue} margin={{ top: 10, right: 10, left: -5, bottom: 0 }}>
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
                  tickFormatter={formatCurrency}
                />
                <Tooltip content={<DevnubyChartTooltip />} />
                <Bar
                  name="Pendapatan (IDR)"
                  dataKey="revenueIdr"
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>
    </div>
  );
}
