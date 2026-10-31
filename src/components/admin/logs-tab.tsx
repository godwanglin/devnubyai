"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  FileText,
  Activity,
  RefreshCw,
  Search,
  Eye,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { CustomSelect } from "@/components/ui/custom-select";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { AuditStateModal } from "./audit-state-modal";
import type {
  SanitizedAuditLogDto,
  SanitizedRoutingAttemptDto,
} from "@/lib/logs/admin-service";

export function LogsTab() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [activeSubtab, setActiveSubtab] = useState<"audit" | "telemetry">("audit");
  const [loading, setLoading] = useState(true);

  // Audit Logs State
  const [auditLogs, setAuditLogs] = useState<SanitizedAuditLogDto[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotalPages, setAuditTotalPages] = useState(1);
  const [auditSearch, setAuditSearch] = useState("");
  const [auditEntityType, setAuditEntityType] = useState("all");
  const [selectedAuditLog, setSelectedAuditLog] = useState<SanitizedAuditLogDto | null>(null);

  // Routing Telemetry State
  const [telemetry, setTelemetry] = useState<SanitizedRoutingAttemptDto[]>([]);
  const [telemetryTotal, setTelemetryTotal] = useState(0);
  const [telemetryPage, setTelemetryPage] = useState(1);
  const [telemetryTotalPages, setTelemetryTotalPages] = useState(1);
  const [telemetrySearch, setTelemetrySearch] = useState("");
  const [telemetryOutcome, setTelemetryOutcome] = useState("all");

  const fetchAuditLogs = useCallback(async () => {
    await Promise.resolve();
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: auditPage.toString(),
        pageSize: "30",
      });
      if (auditSearch.trim()) params.set("search", auditSearch.trim());
      if (auditEntityType !== "all") params.set("entityType", auditEntityType);

      const res = await fetch(`/api/v1/admin/logs/audit?${params.toString()}`, {
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "Failed to load audit logs");

      setAuditLogs(json.data.items ?? []);
      setAuditTotal(json.data.total ?? 0);
      setAuditTotalPages(json.data.totalPages ?? 1);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }, [auditPage, auditSearch, auditEntityType, toast]);

  const fetchTelemetry = useCallback(async () => {
    await Promise.resolve();
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: telemetryPage.toString(),
        pageSize: "30",
      });
      if (telemetrySearch.trim()) params.set("search", telemetrySearch.trim());
      if (telemetryOutcome !== "all") params.set("outcome", telemetryOutcome);

      const res = await fetch(`/api/v1/admin/logs/routing-attempts?${params.toString()}`, {
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "Failed to load telemetry");

      setTelemetry(json.data.items ?? []);
      setTelemetryTotal(json.data.total ?? 0);
      setTelemetryTotalPages(json.data.totalPages ?? 1);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to load telemetry");
    } finally {
      setLoading(false);
    }
  }, [telemetryPage, telemetrySearch, telemetryOutcome, toast]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (activeSubtab === "audit") {
        void fetchAuditLogs();
      } else {
        void fetchTelemetry();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [activeSubtab, fetchAuditLogs, fetchTelemetry]);

  return (
    <div className="space-y-4">
      {/* Top Header & Subtab Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--ink)]">
            {t("admin.logs.title")}
          </h2>
          <p className="text-xs text-[var(--muted)]">
            {t("admin.logs.description")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Subtab buttons */}
          <div className="flex p-0.5 rounded-[8px] bg-[var(--hover)] border border-[var(--border)] text-xs">
            <button
              type="button"
              onClick={() => setActiveSubtab("audit")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] font-medium transition-colors cursor-pointer ${
                activeSubtab === "audit"
                  ? "bg-[var(--panel)] text-[var(--ink)] shadow-xs"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{t("admin.logs.subtabs.audit")}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveSubtab("telemetry")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] font-medium transition-colors cursor-pointer ${
                activeSubtab === "telemetry"
                  ? "bg-[var(--panel)] text-[var(--ink)] shadow-xs"
                  : "text-[var(--muted)] hover:text-[var(--ink)]"
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>{t("admin.logs.subtabs.telemetry")}</span>
            </button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (activeSubtab === "audit") fetchAuditLogs();
              else fetchTelemetry();
            }}
            disabled={loading}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {activeSubtab === "audit" ? (
        /* Audit Logs View */
        <div className="space-y-3">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-2.5 p-3 rounded-[12px] border border-[var(--border)] bg-[var(--panel)]">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--placeholder)] pointer-events-none" />
              <input
                type="search"
                value={auditSearch}
                onChange={(e) => {
                  setAuditPage(1);
                  setAuditSearch(e.target.value);
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
                value={auditEntityType}
                onChange={(val) => {
                  setAuditPage(1);
                  setAuditEntityType(val);
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
            <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">
              <span>
                {t("admin.logs.pagination", {
                  page: auditPage,
                  totalPages: auditTotalPages,
                  total: auditTotal,
                })}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={auditPage <= 1}
                  onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={auditPage >= auditTotalPages}
                  onClick={() => setAuditPage((p) => Math.min(auditTotalPages, p + 1))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Routing Telemetry View */
        <div className="space-y-3">
          {/* Filter Bar */}
          <div className="flex flex-col sm:flex-row gap-2.5 p-3 rounded-[12px] border border-[var(--border)] bg-[var(--panel)]">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--placeholder)] pointer-events-none" />
              <input
                type="search"
                value={telemetrySearch}
                onChange={(e) => {
                  setTelemetryPage(1);
                  setTelemetrySearch(e.target.value);
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
                value={telemetryOutcome}
                onChange={(val) => {
                  setTelemetryPage(1);
                  setTelemetryOutcome(val);
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
                                className="text-[var(--muted)] hover:text-[var(--ink)]"
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
            <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--muted)]">
              <span>
                {t("admin.logs.pagination", {
                  page: telemetryPage,
                  totalPages: telemetryTotalPages,
                  total: telemetryTotal,
                })}
              </span>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" disabled={telemetryPage <= 1} onClick={() => setTelemetryPage((p) => Math.max(1, p - 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="sm" disabled={telemetryPage >= telemetryTotalPages} onClick={() => setTelemetryPage((p) => Math.min(telemetryTotalPages, p + 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AuditStateModal log={selectedAuditLog} onClose={() => setSelectedAuditLog(null)} />
    </div>
  );
}
