"use client";

import React from "react";
import {
  Copy,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  User as UserIcon,
  DollarSign,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { SanitizedRoutingAttemptDto } from "@/lib/logs/admin-service";

export function formatLogCostUsd(costUsd: number | null | undefined): string {
  const val = typeof costUsd === "number" && Number.isFinite(costUsd) ? costUsd : 0;
  if (val === 0) return "$0.00";
  if (val < 0.01) return `$${val.toFixed(6).replace(/0+$/, "").replace(/\.$/, ".00")}`;
  if (val < 1) return `$${val.toFixed(4)}`;
  return `$${val.toFixed(2)}`;
}

export interface TelemetryLogRowProps {
  item: SanitizedRoutingAttemptDto;
  hideUserColumn: boolean;
  colCount: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
}

export function TelemetryLogRow({
  item,
  hideUserColumn,
  colCount,
  isExpanded,
  onToggleExpand,
}: TelemetryLogRowProps) {
  const requestedModel = item.catalogModelPublicId ?? `Model #${item.catalogModelId}`;
  const candidateModel = item.upstreamModelKey ?? `Upstream #${item.upstreamModelId}`;
  const hasMultipleCandidates =
    (item.candidates && item.candidates.length > 1) ||
    Boolean(item.providerError) ||
    Boolean(item.clientError);

  return (
    <React.Fragment>
      <tr className="hover:bg-[var(--hover)] transition-colors align-top">
        {/* Timestamp + Request ID */}
        <td className="py-2.5 px-3 whitespace-nowrap">
          <div className="text-[var(--ink)] font-mono">
            {new Date(item.createdAt).toLocaleTimeString()}
          </div>
          <div className="flex items-center gap-1 font-mono text-[10px] text-[var(--muted)] mt-0.5">
            <span>{item.requestId.slice(0, 8)}...</span>
            <Tooltip content={`Copy Request ID: ${item.requestId}`}>
              <button
                type="button"
                onClick={() => void navigator.clipboard?.writeText(item.requestId)}
                className="text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer"
              >
                <Copy className="w-2.5 h-2.5" />
              </button>
            </Tooltip>
          </div>
        </td>

        {/* User Info */}
        {!hideUserColumn && (
          <td className="py-2.5 px-3">
            {item.userId ? (
              <div className="min-w-[120px]">
                <div className="font-semibold text-[var(--ink)] flex items-center gap-1 truncate max-w-[160px]">
                  <UserIcon className="w-3 h-3 text-[var(--muted)] shrink-0" />
                  <span className="truncate">{item.userName || `User #${item.userId}`}</span>
                </div>
                {item.userEmail && (
                  <div className="text-[10px] text-[var(--muted)] truncate max-w-[160px]">
                    {item.userEmail}
                  </div>
                )}
                <div className="text-[9px] font-mono text-[var(--muted)]">ID: {item.userId}</div>
              </div>
            ) : (
              <span className="text-[var(--muted)] italic text-[11px]">System / Guest</span>
            )}
          </td>
        )}

        {/* Model & Routing Candidate */}
        <td className="py-2.5 px-3">
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
            <span className="px-1.5 py-0.5 rounded bg-[var(--hover)] border border-[var(--border)] text-[var(--ink)] font-semibold">
              {requestedModel}
            </span>
            <ArrowRight className="w-3 h-3 text-[var(--muted)] shrink-0" />
            <span className="px-1.5 py-0.5 rounded bg-[var(--primary)]/10 border border-[var(--primary)]/20 text-[var(--primary)] font-semibold">
              {candidateModel}
            </span>
          </div>
          <div className="text-[10px] text-[var(--muted)] mt-1 flex items-center gap-2">
            <span>
              Gateway:{" "}
              <strong className="text-[var(--ink)]">
                {item.gatewayName ?? `#${item.gatewayId}`}
              </strong>
            </span>
            {item.candidates && item.candidates.length > 1 && (
              <span className="text-amber-500 font-medium">
                ({item.candidates.length} candidates tried)
              </span>
            )}
          </div>
        </td>

        {/* Attempt */}
        <td className="py-2.5 px-3 font-mono font-semibold text-center">#{item.attemptNo}</td>

        {/* Outcome */}
        <td className="py-2.5 px-3">
          <div className="flex flex-col items-start gap-1">
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
              {(item.outcome === "failed" || item.outcome === "aborted") && (
                <XCircle className="w-3 h-3" />
              )}
              <span className="capitalize">{item.outcome}</span>
            </span>
            {item.hadFallback && item.outcome === "success" && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-medium text-amber-500">
                <AlertTriangle className="w-2.5 h-2.5" /> via fallback
              </span>
            )}
          </div>
        </td>

        {/* Latency */}
        <td className="py-2.5 px-3 font-mono whitespace-nowrap">
          <span className="text-[var(--ink)] font-semibold">{item.latencyMs}ms</span>
          {item.ttftMs !== null && item.ttftMs !== undefined && (
            <span className="text-[10px] text-[var(--muted)] block">TTFT: {item.ttftMs}ms</span>
          )}
        </td>

        {/* Tokens */}
        <td className="py-2.5 px-3 font-mono text-[11px] text-[var(--muted)] whitespace-nowrap">
          <div>
            In: <span className="text-[var(--ink)]">{item.promptTokens ?? 0}</span>
          </div>
          <div>
            Out: <span className="text-[var(--ink)]">{item.completionTokens ?? 0}</span>
          </div>
        </td>

        {/* Cost ($) */}
        <td className="py-2.5 px-3 font-mono whitespace-nowrap">
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-semibold text-[11px]">
            <DollarSign className="w-3 h-3 opacity-80" />
            {formatLogCostUsd(item.costUsd).replace(/^\$/, "")}
          </span>
        </td>

        {/* Error & Detail Toggle */}
        <td className="py-2.5 px-3 max-w-[260px]">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1 min-w-0">
              {item.providerError ? (
                <div className="text-[10px]">
                  <span className="font-semibold text-rose-400">Provider: </span>
                  <span className="text-[var(--ink)] break-words">{item.providerError}</span>
                </div>
              ) : item.errorClass ? (
                <span className="font-mono text-[10px] text-rose-400">
                  {item.errorClass} {item.httpStatus ? `(${item.httpStatus})` : ""}
                </span>
              ) : item.hadFallback ? (
                <span className="text-[10px] text-amber-500">
                  Previous candidate failed (see details)
                </span>
              ) : (
                <span className="text-[var(--muted)]">—</span>
              )}

              {item.clientError && (
                <div className="text-[10px]">
                  <span className="font-semibold text-amber-400">Client: </span>
                  <span className="text-[var(--muted)] break-words">{item.clientError}</span>
                </div>
              )}
            </div>

            {hasMultipleCandidates && (
              <Tooltip content="Lihat detail kandidat & error">
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-sm"
                  onClick={onToggleExpand}
                  className="shrink-0"
                >
                  {isExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </Button>
              </Tooltip>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded Candidate Attempts & Error Breakdown */}
      {isExpanded && (
        <tr className="bg-[var(--panel-elevated)]/60">
          <td colSpan={colCount} className="px-4 py-3">
            <div className="space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-[var(--ink)]">
                  Riwayat Kandidat Routing ({requestedModel})
                </span>
                <span className="font-mono text-[10px] text-[var(--muted)]">
                  Request ID: {item.requestId}
                </span>
              </div>

              <div className="grid gap-2">
                {(item.candidates ?? []).map((cand) => (
                  <div
                    key={`${item.id}_cand_${cand.attemptNo}`}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-[8px] border border-[var(--border)] bg-[var(--panel)]"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-[var(--hover)] text-[var(--ink)]">
                        Attempt #{cand.attemptNo}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          cand.outcome === "success"
                            ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                            : cand.outcome === "fallback"
                              ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                              : "bg-red-500/10 text-red-500 border border-red-500/20"
                        }`}
                      >
                        <span className="capitalize">{cand.outcome}</span>
                      </span>
                      <span className="font-mono text-[11px] text-[var(--ink)] font-semibold">
                        {requestedModel} → {cand.upstreamModelKey ?? `#${cand.upstreamModelId}`}
                      </span>
                      <span className="text-[11px] text-[var(--muted)]">
                        ({cand.gatewayName ?? `Gateway #${cand.gatewayId}`})
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
                      <span>Latency: {cand.latencyMs}ms</span>
                      {cand.ttftMs !== null && <span>TTFT: {cand.ttftMs}ms</span>}
                      {cand.httpStatus && <span>HTTP {cand.httpStatus}</span>}
                    </div>

                    {cand.providerError && (
                      <div className="w-full text-[11px] pt-1 border-t border-[var(--border)]/60 text-rose-400">
                        <strong>Provider Error:</strong> {cand.providerError}
                        {cand.errorRuleId && (
                          <span className="ml-1.5 font-mono text-[10px] text-[var(--muted)]">
                            [rule: {cand.errorRuleId}]
                          </span>
                        )}
                        {cand.rawProviderError && cand.rawProviderError !== cand.providerError && (
                          <div className="mt-1.5 p-2 rounded bg-black/40 border border-rose-500/30 text-rose-300 font-mono text-[10px] whitespace-pre-wrap break-all max-h-[160px] overflow-y-auto">
                            <span className="text-[9px] uppercase tracking-wider text-[var(--muted)] block mb-0.5">
                              Raw Upstream Response:
                            </span>
                            {cand.rawProviderError}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {item.clientError && (
                <div className="p-2.5 rounded-[8px] border border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-300">
                  <strong>Error yang dikirim ke Client:</strong> {item.clientError}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </React.Fragment>
  );
}
