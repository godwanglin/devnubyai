"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  Globe,
  LogOut,
  Settings as SettingsIcon,
  Shield,
  Sparkles,
} from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { DropdownSeparator } from "@/components/ui/dropdown";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";
import { useQuota } from "@/hooks/use-quota";
import { LOCALES } from "@/lib/i18n/locales";
import type { Locale, UserProfile } from "@/types";

interface SidebarAccountProps {
  user: UserProfile;
  stale: boolean;
  locale: Locale;
  setLocale: (loc: Locale) => void;
  onCloseMobile: () => void;
  onLogout: () => void;
}

export function SidebarAccountCard({
  user,
  stale,
  locale,
  setLocale,
  onCloseMobile,
  onLogout,
}: SidebarAccountProps) {
  const { t } = useI18n();
  const isFree = !user.plan || user.plan === "free";
  const [languageOpen, setLanguageOpen] = useState(false);
  const currentLocale = LOCALES.find((l) => l.code === locale);

  return (
    <div
      aria-busy={stale}
      className={cn(
        "space-y-3 transition-[filter,opacity] duration-300",
        stale && "blur-[2px] opacity-60 pointer-events-none select-none"
      )}
    >
      <SidebarQuota onNavigate={onCloseMobile} />

      <Popover
        side="top"
        align="end"
        className="w-[220px]"
        trigger={
          <button
            type="button"
            className="flex items-center gap-2.5 w-full p-1.5 rounded-[10px] hover:bg-[var(--hover)] transition-colors text-left cursor-pointer group"
            aria-label={t("nav.accountOptions")}
          >
            <span className="grid place-items-center w-7 h-7 rounded-full bg-[var(--accent)] text-[var(--accent-text)] text-[11px] font-bold shrink-0">
              {user.initials}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-[var(--ink)] truncate">{user.name}</p>
              <p className="text-[11px] text-[var(--placeholder)] truncate">
                {user.planLabel}
              </p>
            </div>
          </button>
        }
      >
        <div className="space-y-0.5">
          {/* Show Upgrade menu item only if user is on free plan */}
          {isFree && (
            <Link
              href="/plans"
              onClick={onCloseMobile}
              className="glass-hover flex items-center gap-2 w-full px-2.5 py-1.5 rounded-[6px] text-xs font-semibold text-[var(--accent)] hover:text-[var(--accent-hover)]"
            >
              <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span>{t("nav.upgrade")}</span>
            </Link>
          )}

          <Link
            href="#/settings"
            onClick={onCloseMobile}
            className="glass-hover flex items-center gap-2 w-full px-2.5 py-1.5 rounded-[6px] text-xs font-medium text-[var(--ink)]"
          >
            <SettingsIcon className="w-3.5 h-3.5 text-[var(--muted)]" />
            <span>{t("nav.settings")}</span>
          </Link>

          {user.role === "admin" && (
            <Link
              href="/admin/metrics"
              onClick={onCloseMobile}
              className="glass-hover flex items-center gap-2 w-full px-2.5 py-1.5 rounded-[6px] text-xs font-medium text-[var(--ink)]"
            >
              <Shield className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span>{t("nav.adminCatalog")}</span>
            </Link>
          )}

          {/* Language picker: expands in place so the list can grow with LOCALES */}
          <button
            type="button"
            onClick={() => setLanguageOpen((v) => !v)}
            aria-expanded={languageOpen}
            className="glass-hover flex items-center justify-between w-full px-2.5 py-1.5 rounded-[6px] text-xs font-medium text-[var(--ink)] cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Globe className="w-3.5 h-3.5 text-[var(--muted)]" />
              <span>{t("nav.language")}</span>
            </span>
            <span className="flex items-center gap-1 text-[11px] text-[var(--muted)]">
              <span className="truncate max-w-[90px]">{currentLocale?.nativeName}</span>
              <ChevronDown
                className={cn(
                  "w-3.5 h-3.5 transition-transform duration-200 ease-[var(--ease-out)]",
                  !languageOpen && "-rotate-90"
                )}
              />
            </span>
          </button>

          <div
            inert={!languageOpen}
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-200 ease-[var(--ease-out)]",
              languageOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"
            )}
          >
            <div className="overflow-hidden min-h-0">
              <div role="listbox" aria-label={t("nav.language")} className="space-y-0.5 pl-5 py-0.5">
                {LOCALES.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    role="option"
                    aria-selected={l.code === locale}
                    onClick={() => setLocale(l.code)}
                    className="glass-hover flex items-center justify-between w-full px-2.5 py-1.5 rounded-[6px] text-xs font-medium text-[var(--ink)] cursor-pointer"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-5 text-[10px] uppercase font-bold text-[var(--muted)]">{l.code}</span>
                      <span className="truncate">{l.nativeName}</span>
                    </span>
                    {l.code === locale ? <Check className="w-3.5 h-3.5 shrink-0 text-[var(--ink)]" /> : null}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DropdownSeparator />

          <button
            type="button"
            onClick={onLogout}
            className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-[6px] text-xs font-medium text-red-500 hover:bg-red-500/10 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{t("nav.logout")}</span>
          </button>
        </div>
      </Popover>
    </div>
  );
}

function formatResetIn(resetAt: string): string {
  const ms = new Date(resetAt).getTime() - Date.now();
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}j ${minutes % 60}m`;
  return `${Math.ceil(hours / 24)}h`;
}

/** Long windows only take over the sidebar once 10% or less of them is left. */
const LONG_WINDOW_ALERT_PERCENT = 90;

/**
 * Always shows the 5-hour window, unless the weekly or monthly window is down to its last 10%
 * (then that one is shown). Windows set to 0 (unlimited) are skipped.
 */
export function SidebarQuota({ onNavigate }: { onNavigate: () => void }) {
  const { t } = useI18n();
  const { quota } = useQuota();
  const windows = quota?.windows;

  type Candidate = { label: string; w: NonNullable<typeof windows>["fiveHour"] };
  const pickTightest = (list: Candidate[]) =>
    list.reduce<Candidate | null>(
      (best, c) => (best === null || c.w.usedPercent > best.w.usedPercent ? c : best),
      null
    );

  let tightest: Candidate | null = null;
  if (windows) {
    const fiveHour: Candidate = { label: t("usage.fiveHour"), w: windows.fiveHour };
    const longWindows: Candidate[] = [
      { label: t("usage.weekly"), w: windows.weekly },
      { label: t("usage.monthly"), w: windows.monthly },
    ].filter((c) => c.w.limitUsd !== null);
    const nearlyExhausted = longWindows.filter((c) => c.w.usedPercent >= LONG_WINDOW_ALERT_PERCENT);

    tightest =
      pickTightest(nearlyExhausted) ??
      (fiveHour.w.limitUsd !== null ? fiveHour : pickTightest(longWindows));
  }

  const label = tightest?.label ?? t("nav.monthlyQuota");
  const percent = tightest?.w.usedPercent ?? 0;
  const barColor = percent >= 90 ? "bg-red-500" : percent >= 75 ? "bg-amber-500" : "bg-[var(--accent)]";

  return (
    <Link
      href="#/settings/usage"
      onClick={onNavigate}
      className="block rounded-[8px] -mx-1 px-1 py-0.5 hover:bg-[var(--hover)] transition-colors"
    >
      <div className="flex justify-between text-xs mb-1.5">
        <span className="text-[var(--muted)]">{label}</span>
        <span className="font-semibold text-[var(--ink)]">{tightest ? `${percent}%` : "∞"}</span>
      </div>
      <div className="h-1 rounded-full bg-[var(--border)] overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${percent}%` }} />
      </div>
      <p className="text-[11px] text-[var(--placeholder)] mt-1.5">
        {tightest
          ? t("usage.resetsIn", { time: formatResetIn(tightest.w.resetAt) })
          : t("usage.unlimited")}
      </p>
    </Link>
  );
}

/** Placeholder with the same footprint as the quota + account block, shown before any data exists. */
export function AccountSkeleton() {
  return (
    <div className="space-y-3 animate-pulse" aria-busy="true">
      <div>
        <div className="flex justify-between mb-1.5">
          <span className="h-3 w-24 rounded bg-[var(--hover)]" />
          <span className="h-3 w-8 rounded bg-[var(--hover)]" />
        </div>
        <div className="h-1 rounded-full bg-[var(--hover)]" />
        <span className="block h-2.5 w-20 mt-2 rounded bg-[var(--hover)]" />
      </div>
      <div className="flex items-center gap-2.5 p-1.5">
        <span className="w-7 h-7 rounded-full bg-[var(--hover)]" />
        <div className="flex-1 space-y-1.5">
          <span className="block h-3 w-28 rounded bg-[var(--hover)]" />
          <span className="block h-2.5 w-16 rounded bg-[var(--hover)]" />
        </div>
      </div>
    </div>
  );
}
