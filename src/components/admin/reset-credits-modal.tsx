"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, RefreshCw, Clock, History } from "lucide-react";
import type {
  ResetCreditsAvailabilityResult,
  ResetCreditsHistoryResult,
} from "@/lib/oauth/quota/openai";

interface ResetCreditsModalProps {
  providerId: string;
  connectionId: string;
  accountLabel: string;
  isOpen: boolean;
  onClose: () => void;
  onRequestUseCredit?: () => void;
}

type FetchResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function fetchJson<T>(url: string): Promise<FetchResult<T>> {
  try {
    const res = await fetch(url, { credentials: "same-origin" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json?.error?.message || `HTTP ${res.status}` };
    return { ok: true, data: json.data as T };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

const KIND_META: Record<string, { label: string; className: string }> = {
  granted: { label: "Diberikan", className: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20" },
  used: { label: "Dipakai", className: "bg-sky-500/10 text-sky-500 border-sky-500/20" },
  expired: { label: "Kedaluwarsa", className: "bg-[var(--surface)] text-[var(--muted)] border-[var(--border)]" },
};

function kindMeta(kind: string) {
  return KIND_META[kind] ?? { label: kind, className: "bg-[var(--surface)] text-[var(--ink)] border-[var(--border)]" };
}

/** "RateLimitResetCredit_cbf29b1c…" → "cbf29b1c" for a compact, still-matchable id. */
function shortCreditId(creditId: string | null): string {
  if (!creditId) return "-";
  const hash = creditId.replace(/^RateLimitResetCredit_/, "");
  return hash.slice(0, 8);
}

function formatAgo(iso?: string | null): string {
  if (!iso) return "";
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(diffMin) || diffMin < 0) return "";
  if (diffMin < 60) return `${diffMin}m lalu`;
  if (diffMin < 1440) return `${Math.floor(diffMin / 60)}j lalu`;
  return `${Math.floor(diffMin / 1440)} hari lalu`;
}

function formatDate(iso?: string | null): string {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "-";
    return d.toLocaleString("id-ID", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function formatRemaining(expiresAt?: string | null): string {
  if (!expiresAt) return "-";
  try {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return "Expired";
    const days = Math.floor(diff / (24 * 3600 * 1000));
    const hours = Math.floor((diff % (24 * 3600 * 1000)) / (3600 * 1000));
    if (days > 0) return `${days}h ${hours}j lagi`;
    return `${hours}j lagi`;
  } catch {
    return "-";
  }
}

export function ResetCreditsModal({
  providerId,
  connectionId,
  accountLabel,
  isOpen,
  onClose,
  onRequestUseCredit,
}: ResetCreditsModalProps) {
  const [tab, setTab] = useState<"available" | "history">("available");
  const [loadingAvailable, setLoadingAvailable] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [availableData, setAvailableData] = useState<ResetCreditsAvailabilityResult | null>(null);
  const [historyData, setHistoryData] = useState<ResetCreditsHistoryResult | null>(null);
  const [errorAvailable, setErrorAvailable] = useState<string | null>(null);
  const [errorHistory, setErrorHistory] = useState<string | null>(null);
  const [availableCachedAt, setAvailableCachedAt] = useState<string | null>(null);
  const [historyCachedAt, setHistoryCachedAt] = useState<string | null>(null);

  const baseUrl = `/api/v1/admin/gateway/providers/${providerId}/connections/${connectionId}/reset-credits`;

  // Pure fetches (no state): effects apply their results in .then callbacks.
  // The server caches both for 5 minutes; fresh=true (refresh button) bypasses it.
  const requestAvailable = useCallback(
    (fresh = false) =>
      fetchJson<{ resetCredits: ResetCreditsAvailabilityResult; cachedAt?: string }>(
        fresh ? `${baseUrl}?fresh=1` : baseUrl
      ),
    [baseUrl]
  );
  const requestHistory = useCallback(
    (fresh = false) =>
      fetchJson<{ history: ResetCreditsHistoryResult; cachedAt?: string }>(
        `${baseUrl}/history${fresh ? "?fresh=1" : ""}`
      ),
    [baseUrl]
  );

  const applyAvailable = useCallback(
    (r: FetchResult<{ resetCredits: ResetCreditsAvailabilityResult; cachedAt?: string }>) => {
      if (r.ok) {
        setAvailableData(r.data.resetCredits);
        setAvailableCachedAt(r.data.cachedAt ?? null);
      }
      setErrorAvailable(r.ok ? null : r.error);
      setLoadingAvailable(false);
    },
    []
  );
  const applyHistory = useCallback(
    (r: FetchResult<{ history: ResetCreditsHistoryResult; cachedAt?: string }>) => {
      if (r.ok) {
        setHistoryData(r.data.history);
        setHistoryCachedAt(r.data.cachedAt ?? null);
      }
      setErrorHistory(r.ok ? null : r.error);
      setLoadingHistory(false);
    },
    []
  );

  const cachedAt = tab === "available" ? availableCachedAt : historyCachedAt;

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    void requestAvailable().then((r) => {
      if (active) applyAvailable(r);
    });
    return () => {
      active = false;
    };
  }, [isOpen, requestAvailable, applyAvailable]);

  function openHistoryTab() {
    setTab("history");
    if (historyData === null && !loadingHistory) {
      setLoadingHistory(true);
      void requestHistory().then(applyHistory);
    }
  }

  function handleRefresh() {
    if (tab === "available") {
      setLoadingAvailable(true);
      void requestAvailable(true).then(applyAvailable);
    } else {
      setLoadingHistory(true);
      void requestHistory(true).then(applyHistory);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={providerId === "claude" ? "Claude Limit Resets" : "OpenAI Reset Credits"}
      description={
        providerId === "claude"
          ? `Ketersediaan & info limit reset rate limit untuk akun "${accountLabel}".`
          : `Ketersediaan & riwayat reset credit untuk akun "${accountLabel}".`
      }
      maxWidth="lg"
    >
      <div className="space-y-4 text-xs">
        {/* Tab switcher */}
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-2">
          <div className="flex items-center gap-1 p-1 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setTab("available")}
              className={`px-3 py-1 rounded-[6px] font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                tab === "available"
                  ? "bg-[var(--panel)] text-[var(--ink)] shadow-xs"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Tersedia ({availableData?.availableCount ?? "..."})</span>
            </button>
            <button
              type="button"
              onClick={openHistoryTab}
              className={`px-3 py-1 rounded-[6px] font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                tab === "history"
                  ? "bg-[var(--panel)] text-[var(--ink)] shadow-xs"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>Riwayat</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {cachedAt && (
              <span className="text-[10px] text-[var(--muted)]" title={`Cached at ${formatDate(cachedAt)}`}>
                Cache · {formatAgo(cachedAt) || "baru saja"}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={tab === "available" ? loadingAvailable : loadingHistory}
              title="Refresh langsung dari upstream (bypass cache)"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${
                  (tab === "available" ? loadingAvailable : loadingHistory) ? "animate-spin" : ""
                }`}
              />
            </Button>
          </div>
        </div>

        {/* Tab 1: Available */}
        {tab === "available" && (
          <div className="space-y-3">
            {errorAvailable && (
              <div className="p-2.5 rounded-[8px] bg-red-500/10 border border-red-500/20 text-red-500 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{errorAvailable}</span>
              </div>
            )}

            {loadingAvailable ? (
              <div className="py-10 text-center space-y-2 text-[var(--muted)]">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-[var(--muted)]" />
                <p>Memeriksa ketersediaan reset credits...</p>
              </div>
            ) : (availableData?.credits?.length ?? 0) === 0 ? (
              <div className="py-8 text-center space-y-1.5 text-[var(--muted)] border border-dashed border-[var(--border)] rounded-[8px]">
                <Clock className="w-6 h-6 mx-auto opacity-40" />
                <p className="font-medium text-[var(--ink)]">Tidak ada reset credits tersedia</p>
                <p className="text-[11px]">Akun ini tidak memiliki kredit aktif untuk mereset rate limit.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-[8px] border border-[var(--border)]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--surface)] text-[10px] uppercase tracking-wider text-[var(--muted)] border-b border-[var(--border)]">
                    <tr>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Granted At</th>
                      <th className="px-3 py-2 font-medium">Expires At</th>
                      <th className="px-3 py-2 font-medium">Sisa Waktu</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {availableData?.credits.map((c, i) => (
                      <tr key={i} className="hover:bg-[var(--surface)]/50 transition-colors">
                        <td className="px-3 py-2">
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                            {c.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-[var(--muted)]">{formatDate(c.grantedAt)}</td>
                        <td className="px-3 py-2 text-[var(--ink)]">{formatDate(c.expiresAt)}</td>
                        <td className="px-3 py-2 font-medium text-[var(--ink)]">
                          {formatRemaining(c.expiresAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: History */}
        {tab === "history" && (
          <div className="space-y-3">
            {errorHistory && (
              <div className="p-2.5 rounded-[8px] bg-red-500/10 border border-red-500/20 text-red-500 flex items-center gap-2">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{errorHistory}</span>
              </div>
            )}

            {loadingHistory ? (
              <div className="py-10 text-center space-y-2 text-[var(--muted)]">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-[var(--muted)]" />
                <p>Memuat riwayat pemakaian dari OpenAI...</p>
              </div>
            ) : (historyData?.items?.length ?? 0) === 0 ? (
              <div className="py-8 text-center space-y-1.5 text-[var(--muted)] border border-dashed border-[var(--border)] rounded-[8px]">
                <History className="w-6 h-6 mx-auto opacity-40" />
                <p className="font-medium text-[var(--ink)]">Belum ada riwayat reset credit</p>
                <p className="text-[11px]">Belum ada kredit yang diberikan atau dipakai dalam periode ini.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--muted)]">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 rounded border bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
                      {historyData?.items.filter((it) => it.kind === "granted").length ?? 0} diberikan
                    </span>
                    <span className="px-1.5 py-0.5 rounded border bg-sky-500/10 text-sky-500 border-sky-500/20">
                      {historyData?.items.filter((it) => it.kind === "used").length ?? 0} dipakai
                    </span>
                  </div>
                  {historyData?.windowStart && (
                    <span>
                      Periode {formatDate(historyData.windowStart)} – {formatDate(historyData.asOf)}
                    </span>
                  )}
                </div>

                <div className="overflow-auto rounded-[8px] border border-[var(--border)] max-h-[300px]">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-[var(--surface)] text-[10px] uppercase tracking-wider text-[var(--muted)] border-b border-[var(--border)] sticky top-0">
                      <tr>
                        <th className="px-3 py-2 font-medium">Event</th>
                        <th className="px-3 py-2 font-medium">Waktu</th>
                        <th className="px-3 py-2 font-medium">Credit ID</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {historyData?.items.map((item) => {
                        const meta = kindMeta(item.kind);
                        return (
                          <tr key={item.id} className="hover:bg-[var(--surface)]/50 transition-colors">
                            <td className="px-3 py-2">
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${meta.className}`}>
                                {meta.label}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <div className="text-[var(--ink)]">{formatDate(item.occurredAt)}</div>
                              <div className="text-[10px] text-[var(--muted)]">{formatAgo(item.occurredAt)}</div>
                            </td>
                            <td className="px-3 py-2 font-mono text-[10px] text-[var(--muted)]" title={item.creditId ?? item.id}>
                              {shortCreditId(item.creditId)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
          <span className="text-[11px] text-[var(--muted)]">
            Mengonsumsi kredit akan mereset limit sesi akun ini secara instan.
          </span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Tutup
            </Button>
            {onRequestUseCredit && (availableData?.availableCount ?? 0) > 0 && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onClose();
                  onRequestUseCredit();
                }}
              >
                Gunakan 1 Kredit
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
