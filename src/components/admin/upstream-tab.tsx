"use client";

import React from "react";
import { ChevronLeft, ChevronRight, Copy, Eye, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { UpstreamMetadataModal } from "@/components/admin/upstream-metadata-modal";
import { CustomSelect } from "@/components/ui/custom-select";
import type {
  SanitizedGatewaySummaryDto,
  SanitizedUpstreamModelDetailDto,
  SanitizedUpstreamModelDto,
} from "@/lib/upstream-models/admin-service";

type GatewayOption = Pick<SanitizedGatewaySummaryDto, "id" | "name" | "slug">;

interface UpstreamListResponse {
  data: {
    items: SanitizedUpstreamModelDto[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

interface GatewayListResponse {
  data: {
    gateways: Array<GatewayOption & { isEnabled: boolean }>;
  };
}

export function UpstreamTab() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [models, setModels] = React.useState<SanitizedUpstreamModelDto[]>([]);
  const [gateways, setGateways] = React.useState<GatewayOption[]>([]);
  const [search, setSearch] = React.useState("");
  const [gatewayId, setGatewayId] = React.useState("");
  const [available, setAvailable] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [pageInfo, setPageInfo] = React.useState({ total: 0, totalPages: 1, pageSize: 50 });
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [selectedModel, setSelectedModel] = React.useState<SanitizedUpstreamModelDetailDto | null>(null);

  const loadGateways = React.useCallback(async () => {
    const response = await fetch("/api/v1/admin/gateways", { credentials: "same-origin" });
    if (!response.ok) throw new Error("Failed to load gateways");
    const payload = (await response.json()) as GatewayListResponse;
    setGateways(payload.data.gateways.map((gateway) => ({ id: gateway.id, name: gateway.name, slug: gateway.slug })));
  }, []);

  const loadModels = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "50", available });
      if (search.trim()) params.set("search", search.trim());
      if (gatewayId) params.set("gatewayId", gatewayId);
      const response = await fetch(`/api/v1/admin/upstream-models?${params.toString()}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error("Failed to load upstream models");
      const payload = (await response.json()) as UpstreamListResponse;
      setModels(payload.data.items);
      setPageInfo({ total: payload.data.total, totalPages: payload.data.totalPages, pageSize: payload.data.pageSize });
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to load upstream models");
    } finally {
      setLoading(false);
    }
  }, [available, gatewayId, page, search, toast]);

  React.useEffect(() => {
    void Promise.resolve().then(() => Promise.all([loadGateways(), loadModels()]));
  }, [loadGateways, loadModels]);

  function changeFilter(next: () => void) {
    setPage(1);
    next();
  }

  async function toggleAvailability(model: SanitizedUpstreamModelDto) {
    setBusyId(model.id);
    try {
      const response = await fetch(`/api/v1/admin/upstream-models/${model.id}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isAvailable: !model.isAvailable }),
      });
      const payload = (await response.json()) as { data?: { model: SanitizedUpstreamModelDto }; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? "Failed to update availability");
      setModels((current) => current.map((item) => item.id === model.id ? payload.data!.model : item));
      toast(t("admin.upstream.toggleSuccess"));
    } catch (error) {
      toast(t("admin.upstream.toggleError", { error: error instanceof Error ? error.message : "unknown error" }));
    } finally {
      setBusyId(null);
    }
  }

  async function inspectModel(model: SanitizedUpstreamModelDto) {
    try {
      const response = await fetch(`/api/v1/admin/upstream-models/${model.id}`, { credentials: "same-origin" });
      if (!response.ok) throw new Error("Failed to load model metadata");
      const payload = (await response.json()) as { data: { model: SanitizedUpstreamModelDetailDto } };
      setSelectedModel(payload.data.model);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Failed to load model metadata");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[var(--ink)]">{t("admin.upstream.title")}</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{t("admin.upstream.description")}</p>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 lg:flex-row">
        <label className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted)]" />
          <input value={search} onChange={(event) => changeFilter(() => setSearch(event.target.value))} placeholder={t("admin.upstream.searchPlaceholder")} className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] pl-9 pr-3 text-xs text-[var(--ink)] outline-none focus:border-[var(--accent)]" />
        </label>
        <div className="w-full lg:w-56">
          <CustomSelect
            options={[
              { value: "", label: t("admin.upstream.filterAllGateways") },
              ...gateways.map((g) => ({ value: g.id, label: g.name, sublabel: `(${g.slug})` })),
            ]}
            value={gatewayId}
            onChange={(val) => changeFilter(() => setGatewayId(val))}
            searchable
          />
        </div>
        <div className="w-full lg:w-44">
          <CustomSelect
            options={[
              { value: "all", label: t("admin.upstream.statusAll") },
              { value: "true", label: t("admin.upstream.statusAvailable") },
              { value: "false", label: t("admin.upstream.statusUnavailable") },
            ]}
            value={available}
            onChange={(val) => changeFilter(() => setAvailable(val))}
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-[var(--border)] text-xs uppercase tracking-wider text-[var(--muted)]"><tr>
              <th className="px-4 py-3">{t("admin.upstream.modelKey")}</th><th className="px-4 py-3">{t("admin.upstream.gateway")}</th><th className="px-4 py-3">{t("admin.upstream.owner")}</th><th className="px-4 py-3">{t("admin.upstream.routesCount")}</th><th className="px-4 py-3">{t("admin.upstream.lastSeen")}</th><th className="px-4 py-3">{t("admin.upstream.actions")}</th>
            </tr></thead>
            <tbody className="divide-y divide-[var(--border)]">
              {loading ? <tr><td colSpan={6} className="px-4 py-10 text-center text-[var(--muted)]">Loading...</td></tr> : models.length === 0 ? <tr><td colSpan={6} className="px-4 py-10 text-center text-[var(--muted)]">{t("admin.upstream.emptyList")}</td></tr> : models.map((model) => <tr key={model.id} className="hover:bg-[var(--hover)]">
                <td className="px-4 py-3"><div className="flex items-center gap-2"><code className="text-xs text-[var(--ink)]">{model.modelKey}</code><button title={t("admin.upstream.copyKey")} onClick={() => void navigator.clipboard?.writeText(model.modelKey)} className="text-[var(--muted)] hover:text-[var(--ink)]"><Copy className="h-3.5 w-3.5" /></button></div><button onClick={() => void toggleAvailability(model)} disabled={busyId === model.id} className={`mt-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${model.isAvailable ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"}`}>{model.isAvailable ? t("admin.upstream.statusAvailable") : t("admin.upstream.statusUnavailable")}</button></td>
                <td className="px-4 py-3"><span className="text-[var(--ink)]">{model.gateway.name}</span><span className="block text-xs text-[var(--muted)]">{model.gateway.slug}</span></td><td className="px-4 py-3 text-[var(--muted)]">{model.ownedBy ?? "—"}</td><td className="px-4 py-3 text-[var(--muted)]">{model.routesCount}</td><td className="px-4 py-3 text-xs text-[var(--muted)]">{new Date(model.lastSeenAt).toLocaleString()}</td><td className="px-4 py-3"><Button variant="ghost" size="sm" onClick={() => void inspectModel(model)}><Eye className="h-3.5 w-3.5" />{t("admin.upstream.viewMetadata")}</Button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]"><span>{t("admin.upstream.pagination", { page, totalPages: pageInfo.totalPages, total: pageInfo.total })}</span><div className="flex gap-1"><Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft className="h-4 w-4" />{t("admin.upstream.previous")}</Button><Button variant="ghost" size="sm" disabled={page >= pageInfo.totalPages} onClick={() => setPage((value) => Math.min(pageInfo.totalPages, value + 1))}>{t("admin.upstream.next")}<ChevronRight className="h-4 w-4" /></Button></div></div>
      </div>
      <UpstreamMetadataModal model={selectedModel} onClose={() => setSelectedModel(null)} />
    </div>
  );
}
