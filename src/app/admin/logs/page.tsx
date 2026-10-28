"use client";

import React from "react";
import { FileText } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";

export default function AdminLogsPage() {
  const { t } = useI18n();

  return (
    <div className="p-8 text-center rounded-[12px] border border-[var(--border)] bg-[var(--panel)] space-y-2">
      <FileText className="w-8 h-8 mx-auto text-[var(--muted)] stroke-1" />
      <h3 className="text-sm font-semibold text-[var(--ink)]">
        {t("admin.tabs.logs")}
      </h3>
      <p className="text-xs text-[var(--muted)]">
        {t("admin.placeholders.logsDesc")}
      </p>
      <p className="text-xs text-[var(--accent)] pt-2">
        {t("admin.placeholders.comingSoon")}
      </p>
    </div>
  );
}
