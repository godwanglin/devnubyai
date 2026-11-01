"use client";

import React, { useState } from "react";
import { FileText, Activity } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import { AuditLogsView } from "./audit-logs-view";
import { TelemetryLogsView } from "./telemetry-logs-view";

export function LogsTab() {
  const { t } = useI18n();
  const [activeSubtab, setActiveSubtab] = useState<"audit" | "telemetry">("audit");

  return (
    <div className="space-y-4">
      {/* Header & Sub-tab switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--ink)]">{t("admin.logs.title")}</h2>
          <p className="text-xs text-[var(--muted)]">{t("admin.logs.description")}</p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-[10px] bg-[var(--panel-elevated)] border border-[var(--border)] self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveSubtab("audit")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-all cursor-pointer ${
              activeSubtab === "audit"
                ? "bg-[var(--surface)] text-[var(--ink)] shadow-xs"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>{t("admin.logs.subtabs.audit")}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSubtab("telemetry")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium transition-all cursor-pointer ${
              activeSubtab === "telemetry"
                ? "bg-[var(--surface)] text-[var(--ink)] shadow-xs"
                : "text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>{t("admin.logs.subtabs.telemetry")}</span>
          </button>
        </div>
      </div>

      {/* Active Tab View */}
      {activeSubtab === "audit" ? <AuditLogsView /> : <TelemetryLogsView />}
    </div>
  );
}
