"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { KeyRound, ChevronRight, RefreshCw, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/providers/toast-provider";
import { ProviderLogo } from "./provider-logo";
import { useSetAdminBreadcrumb } from "./admin-breadcrumb-context";

interface ProviderSummary {
  id: string;
  name: string;
  description: string;
  flow: "pkce" | "device_code";
  iconKey: string;
  logoUrl: string | null;
  connectionCount: number;
  activeCount: number;
  isGatewayConfigured: boolean;
}

export function ProvidersListPage() {
  const { toast } = useToast();
  useSetAdminBreadcrumb([{ label: "OAuth Providers" }]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProviders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/gateway/providers", { credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "Failed to load providers");
      setProviders(json.data.providers ?? []);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to load providers";
      setError(msg);
      toast(msg);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const hasLoadedRef = useRef(false);
  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    void fetchProviders();
  }, [fetchProviders]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-[var(--ink)] flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-[var(--primary)]" />
            <span>OAuth Provider Gateways</span>
          </h2>
          <p className="text-xs text-[var(--muted)]">
            Hubungkan akun OAuth upstream (xAI & Grok CLI) dengan multi-akun pool, reorder prioritas, dan custom headers.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={fetchProviders} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          <span>Refresh</span>
        </Button>
      </div>

      {error && (
        <div className="p-3 rounded-[8px] bg-red-500/10 border border-red-500/20 text-xs text-red-500">
          {error}
        </div>
      )}

      {/* Provider Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {providers.map((p) => {
          return (
            <div
              key={p.id}
              className="p-5 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] hover:border-[var(--border-strong)] transition-all flex flex-col justify-between gap-4"
            >
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <ProviderLogo logoUrl={p.logoUrl} />
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--ink)]">{p.name}</h3>
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)]">
                        {p.flow === "device_code" ? "Device Code Grant" : "PKCE Authorization"}
                      </span>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>{p.activeCount} / {p.connectionCount} Aktif</span>
                    </span>
                  </div>
                </div>

                <p className="text-xs text-[var(--muted)] leading-relaxed">{p.description}</p>
              </div>

              <div className="pt-3 border-t border-[var(--border)] flex items-center justify-between">
                <span className="text-[11px] text-[var(--muted)]">
                  {p.connectionCount === 0
                    ? "Belum ada akun tersambung"
                    : `${p.connectionCount} akun tersimpan di pool`}
                </span>
                <Link href={`/admin/gateway/providers/${p.id}`}>
                  <Button variant="primary" size="sm" className="gap-1">
                    <span>Manage Accounts</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
