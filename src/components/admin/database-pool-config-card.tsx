"use client";

import React, { useEffect, useState } from "react";
import { Database, Loader2, Zap, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";

interface DbPoolConfig {
  max: number;
  connectionTimeoutSeconds: number;
  idleTimeoutSeconds: number;
}

interface LiveDbStats {
  activeConnections: number | null;
  serverMaxConnections: number;
}

export function DatabasePoolConfigCard() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [savedConfig, setSavedConfig] = useState<DbPoolConfig | null>(null);
  const [maxConnections, setMaxConnections] = useState<number>(20);
  const [connectionTimeout, setConnectionTimeout] = useState<number>(20);
  const [idleTimeout, setIdleTimeout] = useState<number>(30);
  const [liveStats, setLiveStats] = useState<LiveDbStats | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/admin/settings/database-pool", { credentials: "same-origin" })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.data?.poolConfig) {
          throw new Error(json?.error?.message);
        }
        if (!active) return;
        const cfg: DbPoolConfig = json.data.poolConfig;
        setSavedConfig(cfg);
        setMaxConnections(cfg.max);
        setConnectionTimeout(cfg.connectionTimeoutSeconds);
        setIdleTimeout(cfg.idleTimeoutSeconds);
        if (json.data.liveStats) {
          setLiveStats(json.data.liveStats);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        toast(err instanceof Error && err.message ? err.message : t("admin.dbPool.loadFailed"));
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [t, toast]);

  const isDirty =
    savedConfig !== null &&
    (maxConnections !== savedConfig.max ||
      connectionTimeout !== savedConfig.connectionTimeoutSeconds ||
      idleTimeout !== savedConfig.idleTimeoutSeconds);

  const isValid =
    maxConnections >= 5 &&
    maxConnections <= 100 &&
    connectionTimeout >= 3 &&
    connectionTimeout <= 60 &&
    idleTimeout >= 5 &&
    idleTimeout <= 300;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid || !isDirty || saving) return;

    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/settings/database-pool", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          max: maxConnections,
          connectionTimeoutSeconds: connectionTimeout,
          idleTimeoutSeconds: idleTimeout,
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.data?.poolConfig) {
        throw new Error(json?.error?.message);
      }

      const updated: DbPoolConfig = json.data.poolConfig;
      setSavedConfig(updated);
      setMaxConnections(updated.max);
      setConnectionTimeout(updated.connectionTimeoutSeconds);
      setIdleTimeout(updated.idleTimeoutSeconds);
      if (json.data.liveStats) {
        setLiveStats(json.data.liveStats);
      }
      toast(t("admin.dbPool.saved"));
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : t("admin.dbPool.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-[14px] border border-[var(--border)] bg-[var(--panel)] p-4 sm:p-5 flex flex-col justify-between shadow-xs">
      {/* Card Header with Live Stats */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Database className="w-4 h-4 text-[var(--accent)] shrink-0" />
          <h3 className="text-sm font-semibold text-[var(--ink)]">{t("admin.dbPool.title")}</h3>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {liveStats && (
            <>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Active: {liveStats.activeConnections ?? "-"}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)]">
                Max: {liveStats.serverMaxConnections}
              </span>
            </>
          )}

          {isDirty ? (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
              Belum Disimpan
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              Tersinkron
            </span>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-xs text-[var(--muted)] gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
          <span>Memuat konfigurasi pool...</span>
        </div>
      ) : (
        <form onSubmit={handleSave} className="mt-3.5 space-y-3.5 flex-1 flex flex-col justify-between">
          <div className="space-y-3">
            {/* 3-Column Compact Numeric Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {/* Max Connections */}
              <div className="space-y-1">
                <div className="flex items-center gap-1">
                  <label htmlFor="db-max-connections" className="text-xs font-medium text-[var(--muted)] truncate">
                    Max Pool
                  </label>
                  <Tooltip
                    content={t("admin.dbPool.maxHint", {
                      serverMax: String(liveStats?.serverMaxConnections ?? 100),
                    })}
                    side="top"
                  >
                    <HelpCircle className="w-3.5 h-3.5 text-[var(--muted)] cursor-help shrink-0" />
                  </Tooltip>
                </div>
                <input
                  id="db-max-connections"
                  type="number"
                  min={5}
                  max={100}
                  required
                  value={maxConnections}
                  onChange={(e) => setMaxConnections(Number(e.target.value))}
                  className="w-full h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-xs font-medium outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>

              {/* Connection Timeout */}
              <div className="space-y-1">
                <div className="flex items-center gap-1">
                  <label htmlFor="db-connection-timeout" className="text-xs font-medium text-[var(--muted)] truncate">
                    Conn Timeout (s)
                  </label>
                  <Tooltip content={t("admin.dbPool.connectionTimeoutHint")} side="top">
                    <HelpCircle className="w-3.5 h-3.5 text-[var(--muted)] cursor-help shrink-0" />
                  </Tooltip>
                </div>
                <input
                  id="db-connection-timeout"
                  type="number"
                  min={3}
                  max={60}
                  required
                  value={connectionTimeout}
                  onChange={(e) => setConnectionTimeout(Number(e.target.value))}
                  className="w-full h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-xs font-medium outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>

              {/* Idle Timeout */}
              <div className="space-y-1">
                <div className="flex items-center gap-1">
                  <label htmlFor="db-idle-timeout" className="text-xs font-medium text-[var(--muted)] truncate">
                    Idle Timeout (s)
                  </label>
                  <Tooltip content={t("admin.dbPool.idleTimeoutHint")} side="top">
                    <HelpCircle className="w-3.5 h-3.5 text-[var(--muted)] cursor-help shrink-0" />
                  </Tooltip>
                </div>
                <input
                  id="db-idle-timeout"
                  type="number"
                  min={5}
                  max={300}
                  required
                  value={idleTimeout}
                  onChange={(e) => setIdleTimeout(Number(e.target.value))}
                  className="w-full h-9 px-3 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-xs font-medium outline-none focus:border-[var(--accent)] transition-colors"
                />
              </div>
            </div>

            {/* Compact Graceful Pool Note */}
            <div className="flex items-center gap-2 px-3 py-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] text-[11.5px] text-[var(--muted)]">
              <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              <span className="truncate">Perubahan pool aktif otomatis via dynamic proxy tanpa restart server.</span>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
            <span className="text-[11px] text-[var(--muted)]">
              {isDirty ? "Ada perubahan belum disimpan" : "Konfigurasi aktif"}
            </span>
            <Button type="submit" size="sm" disabled={!isValid || !isDirty || saving}>
              {saving ? t("admin.dbPool.saving") : t("admin.dbPool.save")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
