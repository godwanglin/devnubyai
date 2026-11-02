"use client";

import React from "react";
import { Database, CheckCircle2, AlertTriangle, XCircle, Table2 } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import type { PostgresHealth } from "@/lib/system-health/types";

export function PostgresHealthCard({ pg }: { pg: PostgresHealth }) {
  const { t } = useI18n();

  const isConnected = pg.status === "connected";
  const isDegraded = pg.status === "degraded";

  const poolUsagePct =
    pg.connections.maxPool > 0
      ? Math.round((pg.connections.total / pg.connections.maxPool) * 100)
      : 0;

  const poolBarColor = poolUsagePct > 80 ? "bg-amber-500" : "bg-emerald-500/90";

  return (
    <div className="p-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] shadow-xs">
            <Database className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[var(--ink)]">
              {t("admin.systemHealth.postgres.title")}
            </h4>
            <p className="text-[11px] text-[var(--muted)] font-mono">
              {pg.dbName} • {pg.version}
            </p>
          </div>
        </div>

        {/* Status Badge */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] text-xs font-medium font-mono border ${
              isConnected
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                : isDegraded
                ? "bg-amber-500/10 text-amber-400 border-amber-500/25"
                : "bg-rose-500/10 text-rose-400 border-rose-500/25"
            }`}
          >
            {isConnected ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : isDegraded ? (
              <AlertTriangle className="w-3.5 h-3.5" />
            ) : (
              <XCircle className="w-3.5 h-3.5" />
            )}
            <span>
              {isConnected
                ? t("admin.systemHealth.postgres.connected")
                : isDegraded
                ? t("admin.systemHealth.postgres.degraded")
                : t("admin.systemHealth.postgres.down")}
            </span>
          </span>
        </div>
      </div>

      {pg.error && (
        <div className="p-3 rounded-[8px] bg-rose-500/10 border border-rose-500/25 text-rose-400 text-xs">
          {pg.error}
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono">
        <div className="p-2.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]/60">
          <span className="text-[10px] text-[var(--muted)] block">Ping Latency</span>
          <span className="text-sm font-bold text-[var(--ink)] mt-0.5 block">
            {pg.latencyMs} ms
          </span>
        </div>
        <div className="p-2.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]/60">
          <span className="text-[10px] text-[var(--muted)] block">{t("admin.systemHealth.postgres.dbSize")}</span>
          <span className="text-sm font-bold text-[var(--ink)] mt-0.5 block">
            {pg.sizePretty}
          </span>
        </div>
        <div className="p-2.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]/60">
          <span className="text-[10px] text-[var(--muted)] block">Active Connections</span>
          <span className="text-sm font-bold text-[var(--ink)] mt-0.5 block">
            {pg.connections.active} <span className="text-[10px] font-normal text-[var(--muted)]">aktif</span>
          </span>
        </div>
        <div className="p-2.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]/60">
          <span className="text-[10px] text-[var(--muted)] block">Idle Connections</span>
          <span className="text-sm font-bold text-[var(--ink)] mt-0.5 block">
            {pg.connections.idle} <span className="text-[10px] font-normal text-[var(--muted)]">idle</span>
          </span>
        </div>
      </div>

      {/* Connection Pool Bar */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center justify-between text-[11px] text-[var(--muted)] font-mono">
          <span>{t("admin.systemHealth.postgres.pool")}</span>
          <span>
            {pg.connections.total} / {pg.connections.maxPool} ({poolUsagePct}%)
          </span>
        </div>
        <div className="w-full h-2 rounded-full bg-[var(--hover)] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${poolBarColor}`}
            style={{ width: `${Math.min(100, Math.max(3, poolUsagePct))}%` }}
          />
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--placeholder)]">
          <Table2 className="w-3 h-3" />
          <span>{t("admin.systemHealth.postgres.tables", { count: pg.tablesCount })}</span>
        </div>
      </div>
    </div>
  );
}
