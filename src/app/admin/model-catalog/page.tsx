"use client";

import React from "react";
import { Sparkles } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";

export default function AdminModelCatalogPage() {
  const { t } = useI18n();

  return (
    <div className="p-8 text-center rounded-[12px] border border-[var(--border)] bg-[var(--panel)] space-y-2">
      <Sparkles className="w-8 h-8 mx-auto text-[var(--muted)] stroke-1" />
      <h3 className="text-sm font-semibold text-[var(--ink)]">
        {t("admin.tabs.chatCatalog")}
      </h3>
      <p className="text-xs text-[var(--muted)]">
        {t("admin.placeholders.chatCatalogDesc")}
      </p>
      <p className="text-xs text-[var(--accent)] pt-2">
        {t("admin.placeholders.comingSoon")}
      </p>
    </div>
  );
}
