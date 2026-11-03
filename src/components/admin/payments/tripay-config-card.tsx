"use client";

import React, { useState, useEffect } from "react";
import { CheckCircle2, XCircle, RefreshCw, Copy, Check, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/providers/toast-provider";
import { cn } from "@/lib/cn";
import type { TripayPublicSettings } from "@/lib/tripay/types";

/** Read-only Tripay status card; credentials and mode live in .env (TRIPAY_*) */
export function TripayConfigCard() {
  const { toast } = useToast();
  const [config, setConfig] = useState<TripayPublicSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    details?: unknown;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/admin/settings/payment/tripay")
      .then((res) => res.json())
      .then((json) => {
        if (!cancelled && json?.data?.settings) setConfig(json.data.settings);
      })
      .catch(() => toast("Gagal memuat konfigurasi Tripay"))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [toast]);

  async function handleTestConnection() {
    try {
      setTesting(true);
      setTestResult(null);
      const res = await fetch("/api/v1/admin/settings/payment/tripay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "test_connection" }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.data?.success) {
        setTestResult({ success: true, message: json.data.message, details: json.data.details });
        toast("Koneksi Tripay berhasil diverifikasi");
      } else {
        const errMsg = json?.error?.message || "Gagal menghubungkan ke Tripay";
        setTestResult({ success: false, message: errMsg });
        toast(errMsg);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Kesalahan jaringan";
      setTestResult({ success: false, message: msg });
      toast(msg);
    } finally {
      setTesting(false);
    }
  }

  function copyCallback() {
    if (!config) return;
    void navigator.clipboard.writeText(config.callbackUrl);
    setCopied(true);
    toast("Callback URL berhasil disalin");
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="p-6 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] flex items-center justify-center gap-2 text-sm text-[var(--muted)]">
        <RefreshCw className="w-4 h-4 animate-spin text-[var(--accent)]" />
        Memuat konfigurasi Tripay...
      </div>
    );
  }

  const isProd = config?.mode === "production";

  return (
    <div className="p-5 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className={cn(
            "w-10 h-10 rounded-[10px] flex items-center justify-center",
            isProd ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20" : "bg-amber-500/10 text-amber-500 border border-amber-500/20"
          )}>
            <QrCode className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-[var(--ink)]">Tripay (VA, E-Wallet, QRIS)</h3>
              <span className={cn(
                "px-2 py-0.5 rounded-full text-xs font-semibold",
                isProd
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25"
                  : "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25"
              )}>
                {isProd ? "LIVE / PRODUCTION" : "SANDBOX"}
              </span>
            </div>
            <p className="text-xs text-[var(--muted)]">
              Mode &amp; kredensial diatur di .env (TRIPAY_MODE, TRIPAY_API_KEY, TRIPAY_PRIVATE_KEY, TRIPAY_MERCHANT_CODE)
            </p>
          </div>
        </div>

        <Button
          size="sm"
          variant="ghost"
          onClick={handleTestConnection}
          disabled={testing || !config?.isConfigured}
          className="border border-[var(--border)] hover:bg-[var(--hover)] gap-1.5"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", testing && "animate-spin text-[var(--accent)]")} />
          {testing ? "Memeriksa..." : "Tes Koneksi"}
        </Button>
      </div>

      {testResult && (
        <div className={cn(
          "p-3 rounded-[8px] text-xs flex items-start gap-2.5 border",
          testResult.success
            ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-700 dark:text-emerald-300"
            : "bg-red-500/10 border-red-500/20 text-red-700 dark:text-red-300"
        )}>
          {testResult.success ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500 mt-0.5" />
          ) : (
            <XCircle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
          )}
          <div className="space-y-1">
            <p className="font-semibold">{testResult.message}</p>
            {testResult.details !== undefined && (
              <pre className="text-[10px] opacity-80 overflow-x-auto p-1.5 rounded bg-black/10">
                {JSON.stringify(testResult.details, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
        <div className="p-3 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] space-y-2">
          <span className="font-semibold text-[var(--ink)] block">Kredensial Aktif</span>
          <div className="flex justify-between items-center py-1 border-b border-[var(--border)]">
            <span className="text-[var(--muted)]">Merchant Code:</span>
            <code className="font-mono text-[var(--ink)] font-medium">{config?.merchantCode || "-"}</code>
          </div>
          <div className="flex justify-between items-center py-1 border-b border-[var(--border)]">
            <span className="text-[var(--muted)]">API Key:</span>
            <code className="font-mono text-[var(--ink)] font-medium">••••••••{config?.apiKeyLast4 || "----"}</code>
          </div>
          <div className="flex justify-between items-center py-1">
            <span className="text-[var(--muted)]">Status:</span>
            <span className={cn("font-medium", config?.isConfigured ? "text-emerald-600 dark:text-emerald-400" : "text-red-500")}>
              {config?.isConfigured ? "Terkonfigurasi" : "Belum lengkap di .env"}
            </span>
          </div>
        </div>

        <div className="p-3 rounded-[8px] bg-[var(--surface)] border border-[var(--border)] space-y-2">
          <span className="font-semibold text-[var(--ink)] block">URL Callback</span>
          <p className="text-[11px] text-[var(--muted)]">
            Daftarkan URL ini di Dashboard Tripay (Merchant &gt; Callback URL):
          </p>
          <div className="flex items-center gap-1.5 pt-1">
            <input
              type="text"
              readOnly
              value={config?.callbackUrl || ""}
              className="w-full px-2.5 py-1.5 rounded-[6px] bg-[var(--panel)] border border-[var(--border)] font-mono text-[11px] text-[var(--ink)] select-all outline-hidden"
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={copyCallback}
              className="shrink-0 h-8 px-2 border border-[var(--border)]"
              title="Salin URL"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
