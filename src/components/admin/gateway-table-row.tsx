"use client";

import React from "react";
import Link from "next/link";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  Zap,
  RotateCcw,
  RefreshCw,
  ExternalLink,
  Pencil,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { SanitizedGatewayDto } from "@/lib/gateways/admin-service";

export interface TestResult {
  testing: boolean;
  latencyMs?: number;
  modelsFound?: number;
  success?: boolean;
  error?: string;
}

export function renderGatewayHealthBadge(status: string) {
  if (status === "healthy") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
        <CheckCircle2 className="w-3 h-3" />
        <span>healthy</span>
      </span>
    );
  }
  if (status === "degraded") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
        <AlertTriangle className="w-3 h-3" />
        <span>degraded</span>
      </span>
    );
  }
  if (status === "down") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-rose-500/10 text-rose-500 border border-rose-500/20">
        <XCircle className="w-3 h-3" />
        <span>down</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
      <HelpCircle className="w-3 h-3" />
      <span>unknown</span>
    </span>
  );
}

export interface GatewayTableRowProps {
  gateway: SanitizedGatewayDto;
  testState?: TestResult;
  isSyncing?: boolean;
  onSetPrimary: (gateway: SanitizedGatewayDto) => void;
  onTest: (gateway: SanitizedGatewayDto) => void;
  onResetCircuit: (gateway: SanitizedGatewayDto) => void;
  onSyncModels: (gateway: SanitizedGatewayDto) => void;
  onEdit: (gateway: SanitizedGatewayDto) => void;
  onDelete: (gateway: SanitizedGatewayDto) => void;
  t: (key: string) => string;
}

export function GatewayTableRow({
  gateway: g,
  testState,
  isSyncing,
  onSetPrimary,
  onTest,
  onResetCircuit,
  onSyncModels,
  onEdit,
  onDelete,
  t,
}: GatewayTableRowProps) {
  const isCircuitOpen = g.circuitOpenUntil && new Date(g.circuitOpenUntil) > new Date();

  return (
    <tr key={g.id} className="hover:bg-[var(--hover)] transition-colors">
      {/* Primary selection */}
      <td className="py-3 px-3 text-center">
        <input
          type="radio"
          name="primary_gateway"
          checked={g.isPrimary}
          onChange={() => {
            if (!g.isPrimary) onSetPrimary(g);
          }}
          className="cursor-pointer accent-[var(--accent)]"
          title={t("admin.gateways.setPrimary")}
        />
      </td>

      {/* Name + slug + wire format */}
      <td className="py-3 px-4">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-[var(--ink)] text-sm">{g.name}</span>
          {g.isPrimary && (
            <span className="px-1.5 py-0.2 rounded-[4px] text-[10px] font-semibold bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]/20">
              PRIMARY
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[var(--muted)] font-mono">
          <span>{g.slug}</span>
          <span>•</span>
          <span className="px-1 rounded bg-[var(--surface)] border border-[var(--border)]">
            {g.wireApi}
          </span>
          <span>•</span>
          <span>prio: {g.priority}</span>
        </div>
      </td>

      {/* Base URL & masked API key */}
      <td className="py-3 px-4 font-mono">
        <div className="text-[12px] text-[var(--ink)] truncate max-w-[280px]" title={g.baseUrl}>
          {g.baseUrl}
        </div>
        <div className="text-[11px] text-[var(--muted)] flex items-center gap-2 mt-0.5">
          <span>Key: {g.apiKeyLast4 ? `••••${g.apiKeyLast4}` : "None"}</span>
          <span>•</span>
          <span>Timeout: {g.timeoutMs}ms</span>
        </div>
      </td>

      {/* Health status & circuit */}
      <td className="py-3 px-3 text-center">
        <div className="flex flex-col items-center gap-1">
          {renderGatewayHealthBadge(g.healthStatus)}
          {isCircuitOpen && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-500/10 text-rose-500">
              Circuit open
            </span>
          )}
        </div>
      </td>

      {/* Enabled toggle indicator */}
      <td className="py-3 px-3 text-center">
        <span
          className={`inline-block w-2.5 h-2.5 rounded-full ${
            g.isEnabled ? "bg-emerald-500" : "bg-zinc-500"
          }`}
          title={g.isEnabled ? t("admin.gateways.enabled") : t("admin.gateways.disabled")}
        />
      </td>

      {/* Actions */}
      <td className="py-3 px-4 text-right">
        <div className="flex items-center justify-end gap-1">
          <Tooltip content={t("admin.gateways.testConnection")}>
            <Button
              variant="ghost"
              size="sm"
              disabled={testState?.testing}
              onClick={() => onTest(g)}
            >
              <Zap className={`w-3.5 h-3.5 ${testState?.testing ? "animate-pulse text-amber-500" : ""}`} />
            </Button>
          </Tooltip>

          {isCircuitOpen && (
            <Tooltip content={t("admin.gateways.resetCircuit")}>
              <Button variant="ghost" size="sm" onClick={() => onResetCircuit(g)}>
                <RotateCcw className="w-3.5 h-3.5 text-amber-500" />
              </Button>
            </Tooltip>
          )}

          <Tooltip content={t("admin.gateways.syncModels")}>
            <Button variant="ghost" size="sm" disabled={isSyncing} onClick={() => onSyncModels(g)}>
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin text-[var(--accent)]" : ""}`} />
            </Button>
          </Tooltip>

          <Tooltip content={t("admin.gateways.viewUpstream")}>
            <Link
              href={`/admin/upstream?gatewayId=${g.id}`}
              className="inline-flex items-center justify-center h-8 w-8 rounded-[8px] hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </Tooltip>

          <Tooltip content={t("admin.gateways.edit")}>
            <Button variant="ghost" size="sm" onClick={() => onEdit(g)}>
              <Pencil className="w-3.5 h-3.5" />
            </Button>
          </Tooltip>

          <Tooltip content={t("admin.gateways.delete")}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDelete(g)}
              className="hover:text-red-500"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </Tooltip>
        </div>

        {testState?.success !== undefined && (
          <div className="mt-1 text-[11px] text-right">
            {testState.success ? (
              <span className="text-emerald-500">
                OK ({testState.latencyMs}ms, {testState.modelsFound ?? 0} models)
              </span>
            ) : (
              <span className="text-rose-500 truncate inline-block max-w-[200px]" title={testState.error}>
                Err: {testState.error}
              </span>
            )}
          </div>
        )}
      </td>
    </tr>
  );
}
