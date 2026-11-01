"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Plus,
  RefreshCw,
  Search,
  Pencil,
  Trash2,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Archive,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { CustomSelect } from "@/components/ui/custom-select";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { useAccount, dispatchModelsInvalidated } from "@/providers/account-provider";
import { CatalogModelModal } from "./catalog-model-modal";
import { DeleteCatalogModal } from "./catalog-confirm-modals";
import type {
  SanitizedCatalogModelDto,
  SanitizedProviderSummaryDto,
  UpstreamModelOptionDto,
  CreateCatalogModelInput,
} from "@/lib/catalog-models/admin-service";

export function CatalogTab() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { refresh: refreshAccount } = useAccount();

  const [models, setModels] = useState<SanitizedCatalogModelDto[]>([]);
  const [providers, setProviders] = useState<SanitizedProviderSummaryDto[]>([]);
  const [upstreamOptions, setUpstreamOptions] = useState<UpstreamModelOptionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [providerFilter, setProviderFilter] = useState("all");

  // Pagination state (default 10)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Modals state
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<SanitizedCatalogModelDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SanitizedCatalogModelDto | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchOptions = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/model-catalog/options", { credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.data) {
        setProviders(json.data.providers ?? []);
        setUpstreamOptions(json.data.upstreamModels ?? []);
      }
    } catch {
      // Non-fatal options loading failure
    }
  }, []);

  const fetchModels = useCallback(async () => {
    await Promise.resolve();
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (providerFilter !== "all") params.set("providerId", providerFilter);

      const res = await fetch(`/api/v1/admin/model-catalog?${params.toString()}`, {
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message || "Failed to load catalog models");
      }
      setModels(json.data.models ?? []);
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to load catalog models");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, providerFilter, toast]);

  const hasFetchedOptionsRef = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!hasFetchedOptionsRef.current) {
        hasFetchedOptionsRef.current = true;
        void fetchOptions();
      }
      void fetchModels();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchOptions, fetchModels]);

  async function handleSaveModel(input: CreateCatalogModelInput) {
    setActionLoading(true);
    try {
      const isEdit = Boolean(selectedModel);
      const url = isEdit
        ? `/api/v1/admin/model-catalog/${selectedModel!.id}`
        : "/api/v1/admin/model-catalog";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message || "Failed to save model");
      }

      toast(isEdit ? t("admin.catalog.updateSuccess") : t("admin.catalog.createSuccess"));
      setModalOpen(false);
      setSelectedModel(null);
      await Promise.allSettled([fetchModels(), refreshAccount()]);
      dispatchModelsInvalidated();
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteModel() {
    if (!deleteTarget) return;
    setActionLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/model-catalog/${deleteTarget.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message || "Failed to delete model");
      }
      toast(t("admin.catalog.deleteSuccess"));
      setDeleteTarget(null);
      await Promise.allSettled([fetchModels(), refreshAccount()]);
      dispatchModelsInvalidated();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete model");
    } finally {
      setActionLoading(false);
    }
  }

  const displayedModels = models.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-4">
      {/* Top action header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--ink)]">
            {t("admin.catalog.title")}
          </h2>
          <p className="text-xs text-[var(--muted)]">
            {t("admin.catalog.description")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              fetchOptions();
              fetchModels();
            }}
            disabled={loading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setSelectedModel(null);
              setModalOpen(true);
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t("admin.catalog.addModel")}</span>
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row gap-2.5 p-3 rounded-[12px] border border-[var(--border)] bg-[var(--panel)]">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--placeholder)] pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder={t("admin.catalog.searchPlaceholder")}
            className="w-full pl-8 pr-3 py-1.5 rounded-[8px] border border-[var(--border)] bg-transparent text-xs text-[var(--ink)] placeholder:text-[var(--placeholder)] focus:border-[var(--accent)] outline-none"
          />
        </div>

        <div className="w-full sm:w-48">
          <CustomSelect
            options={[
              { value: "all", label: t("admin.catalog.allProviders") },
              ...providers.map((p) => ({ value: p.id, label: p.name, sublabel: `(${p.slug})` })),
            ]}
            value={providerFilter}
            onChange={(val) => {
              setProviderFilter(val);
              setPage(1);
            }}
            searchable
          />
        </div>

        <div className="w-full sm:w-40">
          <CustomSelect
            options={[
              { value: "all", label: t("admin.catalog.statusAll") },
              { value: "active", label: t("admin.catalog.statusActive") },
              { value: "draft", label: t("admin.catalog.statusDraft") },
              { value: "deprecated", label: t("admin.catalog.statusDeprecated") },
            ]}
            value={statusFilter}
            onChange={(val) => {
              setStatusFilter(val);
              setPage(1);
            }}
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-elevated)] text-[var(--muted)] font-medium">
                <th className="py-2.5 px-3">{t("admin.catalog.publicId")}</th>
                <th className="py-2.5 px-3">{t("admin.catalog.displayName")}</th>
                <th className="py-2.5 px-3">{t("admin.catalog.provider")}</th>
                <th className="py-2.5 px-3">{t("admin.catalog.routes")}</th>
                <th className="py-2.5 px-3">Price / 1M</th>
                <th className="py-2.5 px-3">{t("admin.catalog.status")}</th>
                <th className="py-2.5 px-3 text-right">{t("admin.catalog.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {loading && models.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[var(--placeholder)]">
                    Loading...
                  </td>
                </tr>
              ) : models.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[var(--placeholder)]">
                    {t("admin.catalog.emptyList")}
                  </td>
                </tr>
              ) : (
                displayedModels.map((m) => (
                  <tr key={m.id} className="hover:bg-[var(--hover)] transition-colors">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5">
                        <code className="font-mono font-semibold text-[var(--ink)]">
                          {m.publicId}
                        </code>
                        {m.badge && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]/20">
                            {m.badge}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-3">
                      <p className="font-medium text-[var(--ink)]">{m.displayName}</p>
                      <p className="text-[11px] text-[var(--muted)]">{m.shortName}</p>
                    </td>

                    <td className="py-3 px-3">
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[6px] bg-[var(--panel-elevated)] border border-[var(--border)] text-[var(--ink)] font-medium">
                        <Sparkles className="w-3 h-3 text-[var(--accent)]" />
                        {m.provider.name}
                      </span>
                    </td>

                    <td className="py-3 px-3 max-w-[280px]">
                      {m.routes.length === 0 ? (
                        <span className="text-[11px] text-[var(--placeholder)] italic">
                          {t("admin.catalog.noRoutes")}
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {m.routes.map((r) => (
                            <span
                              key={r.id}
                              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono border ${
                                r.isEnabled
                                  ? r.gatewayIsPrimary
                                    ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                                    : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                                  : "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                              }`}
                              title={`Priority #${r.priority} on ${r.gatewayName}`}
                            >
                              <span className="font-bold">#{r.priority}</span>
                              {r.gatewayIsPrimary && <ShieldCheck className="w-2.5 h-2.5" />}
                              <span>{r.upstreamModelKey}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-3 whitespace-nowrap">
                      <div className="text-[11px] text-[var(--ink)]">
                        <div>{m.inputPricePerMillion.toFixed(4)} {m.pricingCurrency}</div>
                        <div className="text-[var(--muted)]">out: {m.outputPricePerMillion.toFixed(4)} {m.pricingCurrency}</div>
                      </div>
                    </td>

                    <td className="py-3 px-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-medium ${
                          m.status === "active"
                            ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                            : m.status === "draft"
                            ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                            : "bg-zinc-500/10 text-zinc-400 border border-zinc-500/20"
                        }`}
                      >
                        {m.status === "active" && <CheckCircle2 className="w-3 h-3" />}
                        {m.status === "draft" && <Clock className="w-3 h-3" />}
                        {m.status === "deprecated" && <Archive className="w-3 h-3" />}
                        <span className="capitalize">{m.status}</span>
                      </span>
                    </td>

                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip content={t("admin.catalog.edit")}>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedModel(m);
                              setModalOpen(true);
                            }}
                            className="p-1 rounded-[6px] text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)] transition-colors cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>

                        <Tooltip content={t("admin.catalog.delete")}>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(m)}
                            className="p-1 rounded-[6px] text-red-500/80 hover:text-red-500 hover:bg-red-500/10 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <DataTablePagination
          page={page}
          pageSize={pageSize}
          totalItems={models.length}
          onPageChange={setPage}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setPage(1);
          }}
          disabled={loading}
        />
      </div>

      <CatalogModelModal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setSelectedModel(null);
        }}
        onSave={handleSaveModel}
        model={selectedModel}
        providers={providers}
        upstreamOptions={upstreamOptions}
        loading={actionLoading}
      />

      <DeleteCatalogModal
        model={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteModel}
        loading={actionLoading}
      />
    </div>
  );
}
