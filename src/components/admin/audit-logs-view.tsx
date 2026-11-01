"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Search, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { AuditStateModal } from "./audit-state-modal";
import type { SanitizedAuditLogDto } from "@/lib/logs/admin-service";

export function AuditLogsView() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [auditLogs, setAuditLogs] = useState<SanitizedAuditLogDto[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [entityType, setEntityType] = useState("all");
  const [selectedAuditLog, setSelectedAuditLog] = useState<SanitizedAuditLogDto | null>(null);

  const fetchAuditLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
      });
      if (search.trim()) params.set("search", search.trim());
      if (entityType !== "all") params.set("entityType", entityType);

      const res = await fetch(`/api/v1/admin/logs/audit?${params.toString()}`, {
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "Failed to load audit logs");

      setAuditLogs(json.data.items ?? []);
      setAuditTotal(json.data.total ?? 0);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, entityType, toast]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchAuditLogs();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchAuditLogs]);

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
            placeholder={t("admin.logs.searchPlaceholderAudit")}
            className="w-full pl-8 pr-3 py-1.5 rounded-[8px] border border-[var(--border)] bg-transparent text-xs text-[var(--ink)] placeholder:text-[var(--placeholder)] focus:border-[var(--accent)] outline-none"
          />
        </div>

        <div className="w-full sm:w-48">
          <CustomSelect
            options={[
              { value: "all", label: t("admin.logs.filterAllEntities") },
              { value: "gateway", label: "Gateway" },
              { value: "upstream_model", label: "Upstream Model" },
              { value: "catalog_model", label: "Catalog Model" },
              { value: "route", label: "Route" },
              { value: "routing_setting", label: "Routing Setting" },
              { value: "app_setting", label: "App Setting" },
              { value: "system_prompt", label: "System Prompt" },
            ]}
            value={entityType}
            onChange={(val) => {
              setPage(1);
              setEntityType(val);
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
                <th className="py-2.5 px-3">{t("admin.logs.timestamp")}</th>
                <th className="py-2.5 px-3">{t("admin.logs.actor")}</th>
                <th className="py-2.5 px-3">{t("admin.logs.action")}</th>
                <th className="py-2.5 px-3">{t("admin.logs.entity")}</th>
                <th className="py-2.5 px-3 text-right">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {loading && auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[var(--placeholder)]">
                    Loading...
                  </td>
                </tr>
              ) : auditLogs.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[var(--placeholder)]">
                    {t("admin.logs.emptyAudit")}
                  </td>
                </tr>
              ) : (
                auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-[var(--hover)] transition-colors">
                    <td className="py-2.5 px-3 text-[var(--muted)] font-mono whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString()}
                    </td>

                    <td className="py-2.5 px-3">
                      <p className="font-medium text-[var(--ink)]">
                        {log.actorName ?? "System"}
                      </p>
                      {log.actorEmail && (
                        <p className="text-[10px] text-[var(--muted)] font-mono">
                          {log.actorEmail}
                        </p>
                      )}
                    </td>

                    <td className="py-2.5 px-3">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]/20">
                        {log.action}
                      </span>
                    </td>

                    <td className="py-2.5 px-3 font-mono">
                      <span className="text-[var(--ink)] font-semibold">{log.entityType}</span>
                      {log.entityId && (
                        <span className="text-[var(--muted)] block text-[11px] truncate max-w-[200px]">
                          {log.entityId}
                        </span>
                      )}
                    </td>

                    <td className="py-2.5 px-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedAuditLog(log)}
                        className="h-7 px-2 text-xs"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>{t("admin.logs.viewDiff")}</span>
                      </Button>
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
          totalItems={auditTotal}
          onPageChange={setPage}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setPage(1);
          }}
          disabled={loading}
        />
      </div>

      <AuditStateModal log={selectedAuditLog} onClose={() => setSelectedAuditLog(null)} />
    </div>
  );
}
