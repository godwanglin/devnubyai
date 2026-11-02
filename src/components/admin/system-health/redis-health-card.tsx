"use client";

import React from "react";
import { Layers, CheckCircle2, AlertTriangle, XCircle, KeyRound, Activity } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import type { RedisHealth } from "@/lib/system-health/types";

export function RedisHealthCard({ redis }: { redis: RedisHealth }) {
  const { t } = useI18n();

  const isConnected = redis.status === "connected";
  const isFallback = redis.status === "fallback";

  return (
    <div className="p-4 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] shadow-xs">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-[var(--ink)]">
              {t("admin.systemHealth.redis.title")}
            </h4>
            <p className="text-[11px] text-[var(--muted)] font-mono">
              {redis.mode === "redis"
                ? `Redis ${redis.version || "v7+"}`
                : "In-Memory LRU Cache"}
            </p>
          </div>
        </div>

        {/* Status Badge */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] text-xs font-medium font-mono border ${
              isConnected
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                : isFallback
                ? "bg-amber-500/10 text-amber-400 border-amber-500/25"
                : "bg-rose-500/10 text-rose-400 border-rose-500/25"
            }`}
          >
            {isConnected ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : isFallback ? (
              <AlertTriangle className="w-3.5 h-3.5" />
            ) : (
              <XCircle className="w-3.5 h-3.5" />
            )}
            <span>
              {isConnected
                ? t("admin.systemHealth.redis.connected")
                : isFallback
                ? t("admin.systemHealth.redis.fallback")
                : t("admin.systemHealth.redis.down")}
            </span>
          </span>
        </div>
      </div>

      {redis.error && (
        <div className="p-3 rounded-[8px] bg-amber-500/10 border border-amber-500/25 text-amber-400 text-xs">
          {redis.error}
        </div>
      )}

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs font-mono">
        <div className="p-2.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]/60">
          <span className="text-[10px] text-[var(--muted)] block">{t("admin.systemHealth.redis.latency")}</span>
          <span className="text-sm font-bold text-[var(--ink)] mt-0.5 block">
            {redis.latencyMs !== null ? `${redis.latencyMs} ms` : "N/A"}
          </span>
        </div>
        <div className="p-2.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]/60">
          <span className="text-[10px] text-[var(--muted)] block">{t("admin.systemHealth.redis.usedMemory")}</span>
          <span className="text-sm font-bold text-[var(--ink)] mt-0.5 block truncate">
            {redis.usedMemory || "In-Memory"}
          </span>
        </div>
        <div className="p-2.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]/60">
          <span className="text-[10px] text-[var(--muted)] block">{t("admin.systemHealth.redis.clients")}</span>
          <span className="text-sm font-bold text-[var(--ink)] mt-0.5 block">
            {redis.connectedClients !== null ? redis.connectedClients : 1}
          </span>
        </div>
        <div className="p-2.5 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]/60">
          <span className="text-[10px] text-[var(--muted)] block">Throughput (Ops/sec)</span>
          <span className="text-sm font-bold text-[var(--ink)] mt-0.5 block">
            {redis.opsPerSec !== null ? redis.opsPerSec : "0"}
          </span>
        </div>
      </div>

      {/* Secondary Info row */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-[11px] text-[var(--placeholder)] font-mono border-t border-[var(--divider)]">
        <div className="flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5 text-[var(--muted)]" />
          <span>{t("admin.systemHealth.redis.keys", { count: redis.totalKeys.toLocaleString() })}</span>
        </div>
        {redis.peakMemory && (
          <div className="flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-[var(--muted)]" />
            <span>Puncak Memori: {redis.peakMemory}</span>
          </div>
        )}
      </div>
    </div>
  );
}
