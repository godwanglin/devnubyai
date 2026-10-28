"use client";

import React from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/providers/theme-provider";
import { useToast } from "@/providers/toast-provider";
import { useI18n } from "@/providers/i18n-provider";
import { cn } from "@/lib/cn";

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const { t } = useI18n();

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-[var(--ink)]">
        {t("settings.appearanceTab")}
      </h2>
      <p className="text-xs text-[var(--muted)]">
        Pilih tema tampilan sesuai kenyamananmu.
      </p>

      <div className="grid grid-cols-2 gap-3 max-w-sm">
        <button
          type="button"
          onClick={() => {
            setTheme("light");
            toast(t("toast.lightTheme"));
          }}
          className={cn(
            "flex flex-col items-center gap-2 p-4 rounded-[12px] border text-sm font-medium transition-colors cursor-pointer",
            theme === "light"
              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
              : "border-[var(--border)] hover:bg-[var(--hover)] text-[var(--ink)]"
          )}
        >
          <Sun className="w-5 h-5" />
          <span>Light</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setTheme("dark");
            toast(t("toast.darkTheme"));
          }}
          className={cn(
            "flex flex-col items-center gap-2 p-4 rounded-[12px] border text-sm font-medium transition-colors cursor-pointer",
            theme === "dark"
              ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
              : "border-[var(--border)] hover:bg-[var(--hover)] text-[var(--ink)]"
          )}
        >
          <Moon className="w-5 h-5" />
          <span>Pure Dark</span>
        </button>
      </div>
    </div>
  );
}
