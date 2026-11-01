"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Search, Copy, CheckCircle2, AlertTriangle, XCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { CustomSelect } from "@/components/ui/custom-select";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import type { SanitizedRoutingAttemptDto } from "@/lib/logs/admin-service";

export function TelemetryLogsView() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [telemetry, setTelemetry] = useState<SanitizedRoutingAttemptDto[]>([]);
  const [telemetryTotal, setTelemetryTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [outcome, setOutcome] = useState("all");
  const [date, setDate] = useState("");
  const [availableLogDates, setAvailableLogDates] = useState<string[]>([]);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const activeDate = date || availableLogDates[0] || "";

  const fetchTelemetry = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
      });
      if (search.trim()) params.set("search", search.trim());
      if (outcome !== "all") params.set("outcome", outcome);
      if (date) params.set("date", date);

      const res = await fetch(`/api/v1/admin/logs/routing-attempts?${params.toString()}`, {
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "Failed to load telemetry");

      setTelemetry(json.data.items ?? []);
      setTelemetryTotal(json.data.total ?? 0);
      if (Array.isArray(json.data.availableDates)) {
        setAvailableLogDates(json.data.availableDates);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load telemetry");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, outcome, date, toast]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchTelemetry();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchTelemetry]);

  async function handleDeleteLogFile() {
    if (!activeDate) return;
    setIsDeleting(true);
    try {
      const res = await fetch(
        `/api/v1/admin/logs/routing-attempts?date=${encodeURIComponent(activeDate)}`,
        {
          method: "DELETE",
          credentials: "same-origin",
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error?.message || "Failed to delete log file");
      }
      toast(t("admin.logs.deleteSuccess", { date: activeDate }));
      setDeleteConfirmOpen(false);
      setDate("");
      setPage(1);
      void fetchTelemetry();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Failed to delete log file");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-2.5 p-3 rounded-[12px] border border-[var(--border)] bg-[var(--panel)]">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--placeholder)] pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder={t("admin.logs.searchPlaceholderTelemetry")}
            className="w-full pl-8 pr-3 py-1.5 rounded-[8px] border border-[var(--border)] bg-transparent text-xs text-[var(--ink)] placeholder:text-[var(--placeholder)] focus:border-[var(--accent)] outline-none"
          />
        </div>

        <div className="w-full sm:w-44">
          <CustomSelect
            options={[
              { value: "all", label: t("admin.logs.outcomeAll") },
              { value: "success", label: t("admin.logs.outcomeSuccess") },
              { value: "fallback", label: t("admin.logs.outcomeFallback") },
              { value: "failed", label: t("admin.logs.outcomeFailed") },
              { value: "aborted", label: t("admin.logs.outcomeAborted") },
            ]}
            value={outcome}
            onChange={(val) => {
              setPage(1);
              setOutcome(val);
            }}
          />
        </div>
        {availableLogDates.length > 0 && (
          <div className="flex items-center gap-1.5 w-full sm:w-auto">
            <div className="w-full sm:w-44">
              <CustomSelect
                options={availableLogDates.map((d) => ({
                  value: d,
                  label: d,
                }))}
                value={activeDate}
                onChange={(val) => {
                  setPage(1);
                  setDate(val);
                }}
              />
            </div>
            <Tooltip content={t("admin.logs.deleteLogFile")}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteConfirmOpen(true)}
                className="h-9 w-9 px-0 text-[var(--muted)] hover:text-rose-500 hover:bg-rose-500/10"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </Tooltip>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-elevated)] text-[var(--muted)] font-medium">
                <th className="py-2.5 px-3">{t("admin.logs.timestamp")}</th>
                <th className="py-2.5 px-3">{t("admin.logs.requestId")}</th>
                <th className="py-2.5 px-3">{t("admin.logs.gateway")} / {t("admin.logs.model")}</th>
                <th className="py-2.5 px-3">{t("admin.logs.attempt")}</th>
                <th className="py-2.5 px-3">{t("admin.logs.outcome")}</th>
                <th className="py-2.5 px-3">{t("admin.logs.latency")}</th>
                <th className="py-2.5 px-3">{t("admin.logs.tokens")}</th>
                <th className="py-2.5 px-3">{t("admin.logs.error")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {loading && telemetry.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[var(--placeholder)]">
                    Loading...
                  </td>
                </tr>
              ) : telemetry.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[var(--placeholder)]">
                    {t("admin.logs.emptyTelemetry")}
                  </td>
                </tr>
              ) : (
                telemetry.map((item) => (
                  <tr key={item.id} className="hover:bg-[var(--hover)] transition-colors">
                    <td className="py-2.5 px-3 text-[var(--muted)] font-mono whitespace-nowrap">
                      {new Date(item.createdAt).toLocaleTimeString()}
                    </td>

                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1 font-mono text-[11px] text-[var(--ink)]">
                        <span>{item.requestId.slice(0, 10)}...</span>
                        <Tooltip content="Copy Request ID">
                          <button
                            type="button"
                            onClick={() => void navigator.clipboard?.writeText(item.requestId)}
                            className="text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </Tooltip>
                      </div>
                    </td>

                    <td className="py-2.5 px-3">
                      <p className="font-semibold text-[var(--ink)]">
                        {item.gatewayName ?? `Gateway #${item.gatewayId}`}
                      </p>
                      <p className="text-[10px] text-[var(--muted)] font-mono">
                        {item.catalogModelPublicId ?? `Model #${item.catalogModelId}`}
                      </p>
                    </td>

                    <td className="py-2.5 px-3 font-mono font-semibold text-center">
                      #{item.attemptNo}
                    </td>

                    <td className="py-2.5 px-3">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          item.outcome === "success"
                            ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                            : item.outcome === "fallback"
                            ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                            : "bg-red-500/10 text-red-500 border border-red-500/20"
                        }`}
                      >
                        {item.outcome === "success" && <CheckCircle2 className="w-3 h-3" />}
                        {item.outcome === "fallback" && <AlertTriangle className="w-3 h-3" />}
                        {item.outcome === "failed" && <XCircle className="w-3 h-3" />}
                        <span className="capitalize">{item.outcome}</span>
                      </span>
                    </td>

                    <td className="py-2.5 px-3 font-mono">
                      <span className="text-[var(--ink)] font-semibold">{item.latencyMs}ms</span>
                      {item.ttftMs && (
                        <span className="text-[10px] text-[var(--muted)] block">
                          TTFT: {item.ttftMs}ms
                        </span>
                      )}
                    </td>

                    <td className="py-2.5 px-3 font-mono text-[11px] text-[var(--muted)]">
                      {item.promptTokens ?? 0} / {item.completionTokens ?? 0}
                    </td>

                    <td className="py-2.5 px-3">
                      {item.errorClass ? (
                        <span className="font-mono text-[10px] text-red-400">
                          {item.errorClass} {item.httpStatus ? `(${item.httpStatus})` : ""}
                        </span>
                      ) : (
                        <span className="text-[var(--muted)]">—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <DataTablePagination
          page={page}
          pageSize={pageSize}
          totalItems={telemetryTotal}
          onPageChange={setPage}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setPage(1);
          }}
          disabled={loading}
        />
      </div>

      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDeleteLogFile}
        title={t("admin.logs.deleteConfirmTitle")}
        description={t("admin.logs.deleteConfirmDesc", { date: activeDate })}
        confirmLabel={t("admin.logs.deleteConfirmButton")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        loading={isDeleting}
      />
    </div>
  );
}
