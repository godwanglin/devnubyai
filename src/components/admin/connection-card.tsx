"use client";

import React from "react";
import { GripVertical, RefreshCw, Trash2, Mail, User } from "lucide-react";
import type { SanitizedProviderConnectionDto } from "@/lib/gateways/provider-service";
import type { ProviderQuotaResult, QuotaItem } from "@/lib/oauth/quota";
import { ResetCreditsControl } from "./reset-credits-control";

/** "dalam 2j 15m · 5 Nov 14:00", or null when the timestamp is invalid. */
function formatResetAt(iso: string): string | null {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  const when = date.toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const diffMin = Math.round((date.getTime() - Date.now()) / 60000);
  if (diffMin <= 0) return when;
  const days = Math.floor(diffMin / 1440);
  const hours = Math.floor((diffMin % 1440) / 60);
  const mins = diffMin % 60;
  const rel = days > 0 ? `${days}h ${hours}j` : hours > 0 ? `${hours}j ${mins}m` : `${mins}m`;
  return `dalam ${rel} · ${when}`;
}

interface ConnectionCardProps {
  providerId: string;
  conn: SanitizedProviderConnectionDto;
  index: number;
  quotaSupported: boolean;
  quotaLoading: boolean;
  onDragStart: (index: number) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (index: number) => void;
  onToggleEnabled: (conn: SanitizedProviderConnectionDto) => void;
  onRefreshQuota: (id: string) => void;
  onRequestDelete: (conn: SanitizedProviderConnectionDto) => void;
  onQuotaUpdated?: (quota: ProviderQuotaResult | null) => void;
}

export function ConnectionCard({
  providerId,
  conn,
  index,
  quotaSupported,
  quotaLoading,
  onDragStart,
  onDragOver,
  onDrop,
  onToggleEnabled,
  onRefreshQuota,
  onRequestDelete,
  onQuotaUpdated,
}: ConnectionCardProps) {
  const quota = conn.quotaCached;

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={onDragOver}
      onDrop={() => onDrop(index)}
      className={`p-4 rounded-[10px] border transition-all flex flex-col gap-3 min-w-0 cursor-grab active:cursor-grabbing ${
        conn.isEnabled
          ? "border-[var(--border)] bg-[var(--panel)] hover:border-[var(--border-strong)]"
          : "border-[var(--border)]/50 bg-[var(--surface)]/50 opacity-60"
      }`}
    >
      {/* Header: Drag Handle + User Info + Actions */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-[var(--muted)] hover:text-[var(--ink)] cursor-grab active:cursor-grabbing p-1 shrink-0">
            <GripVertical className="w-4 h-4" />
          </div>

          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-xs text-[var(--ink)] truncate">
                {conn.label || conn.email || conn.displayName || `Account #${conn.id}`}
              </span>
              {conn.cooldownUntil && new Date(conn.cooldownUntil) > new Date() && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/20 font-medium">
                  Cooldown (habis)
                </span>
              )}
              {quota?.plan && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)]">
                  {quota.plan}
                </span>
              )}
              {providerId === "openai" && quota?.resetCreditsAvailable !== undefined && (
                <ResetCreditsControl
                  providerId={providerId}
                  connectionId={conn.id}
                  accountLabel={conn.label || conn.email || conn.displayName || conn.id}
                  availableCount={quota.resetCreditsAvailable}
                  onQuotaUpdated={onQuotaUpdated ?? (() => {})}
                />
              )}
            </div>

            <div className="flex items-center gap-3 text-[11px] text-[var(--muted)] min-w-0">
              {conn.email && (
                <span className="flex items-center gap-1 min-w-0">
                  <Mail className="w-3 h-3 shrink-0" />
                  <span className="truncate">{conn.email}</span>
                </span>
              )}
              {conn.upstreamUserId && (
                <span className="flex items-center gap-1 font-mono text-[10px] min-w-0">
                  <User className="w-3 h-3 shrink-0" />
                  <span className="truncate">{conn.upstreamUserId}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {quotaSupported && (
            <button
              type="button"
              onClick={() => onRefreshQuota(conn.id)}
              disabled={quotaLoading}
              className="p-1.5 text-[var(--muted)] hover:text-[var(--ink)] rounded cursor-pointer disabled:opacity-50"
              title="Refresh Account Quota"
              aria-label="Refresh quota"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${quotaLoading ? "animate-spin" : ""}`} />
            </button>
          )}

          {/* Toggle Switch */}
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={conn.isEnabled}
              onChange={() => onToggleEnabled(conn)}
              className="sr-only peer"
              aria-label="Toggle connection enabled"
            />
            <div className="w-8 h-4.5 bg-neutral-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-emerald-500" />
          </label>

          <button
            type="button"
            onClick={() => onRequestDelete(conn)}
            className="p-1.5 text-[var(--muted)] hover:text-red-500 transition-colors rounded cursor-pointer"
            title="Delete account"
            aria-label="Delete account"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Quota Section */}
      <div className="w-full">
        {quotaSupported ? (
          quota?.quotas && Object.keys(quota.quotas).length > 0 ? (
            <div className="space-y-1.5">
              {Object.entries(quota.quotas as Record<string, QuotaItem>).map(([name, q]) => (
                <div key={name} className="space-y-0.5">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-[var(--muted)]">{name}</span>
                    <span className="font-mono text-[var(--ink)]">
                      {q.unlimited ? "Unlimited" : `${Math.round(q.remainingPercentage)}% remaining`}
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-[var(--surface)] border border-[var(--border)] rounded-full overflow-hidden">
                    {(q.unlimited || q.remainingPercentage > 0) && (
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          q.remainingPercentage < 15
                            ? "bg-red-500"
                            : q.remainingPercentage < 40
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                        }`}
                        style={{
                          width: `${q.unlimited ? 100 : Math.min(100, q.remainingPercentage)}%`,
                        }}
                      />
                    )}
                  </div>
                  {q.resetAt && formatResetAt(q.resetAt) && (
                    <div className="text-[10px] text-[var(--muted)]" title={new Date(q.resetAt).toLocaleString()}>
                      Reset {formatResetAt(q.resetAt)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <span className="text-[11px] text-[var(--muted)] italic">
              {quota?.message || "No quota cached yet"}
            </span>
          )
        ) : (
          <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)] font-mono">
            Quota tidak didukung
          </span>
        )}
      </div>
    </div>
  );
}
