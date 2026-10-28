"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  PanelLeftClose,
  Plus,
  Search,
  MoreHorizontal,
  Settings as SettingsIcon,
  Globe,
  LogOut,
  Sparkles,
} from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { DropdownSeparator } from "@/components/ui/dropdown";
import { useI18n } from "@/providers/i18n-provider";
import { useAccount } from "@/providers/account-provider";
import { cn } from "@/lib/cn";
import type { Session } from "@/types";

interface SidebarProps {
  sessions: Session[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({
  sessions,
  isCollapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const { t, locale, setLocale } = useI18n();
  const { user, loading, stale, logout } = useAccount();
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");

  async function handleLogout() {
    onCloseMobile();
    await logout();
    router.push("/login");
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, query]);

  const groups = useMemo(() => {
    return {
      today: filtered.filter((s) => s.group === "today"),
      yesterday: filtered.filter((s) => s.group === "yesterday"),
      week: filtered.filter((s) => s.group === "week"),
    };
  }, [filtered]);

  function handleNewChat() {
    onCloseMobile();
    router.push("/");
  }

  return (
    <>
      {/* Mobile scrim backdrop */}
      <div
        aria-hidden="true"
        onClick={onCloseMobile}
        className={cn(
          "fixed inset-0 z-[80] bg-black/40 backdrop-blur-xs transition-opacity duration-300 ease-out md:hidden",
          mobileOpen ? "visible opacity-100" : "invisible opacity-0 pointer-events-none"
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-[95] flex w-[280px] shrink-0 flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--panel)] md:static md:z-[90] md:translate-x-0",
          "transition-[translate,width] duration-300 ease-[var(--ease-out)] motion-reduce:transition-none",
          isCollapsed ? "md:w-0 md:border-r-0 md:pointer-events-none md:invisible" : "md:w-[272px]",
          mobileOpen ? "translate-x-0" : "-translate-x-full pointer-events-none md:pointer-events-auto",
          !mobileOpen && "invisible md:visible"
        )}
      >
        {/* Top brand + collapse button */}
        <div className="flex items-center justify-between gap-3 px-3.5 py-3.5 border-b border-[var(--border)]">
          <Link href="/" className="flex items-center gap-2.5 font-bold text-[17px] text-[var(--ink)]">
            <span className="grid place-items-center w-8 h-8 rounded-[6px] bg-[var(--accent)] text-[var(--accent-text)]">
              <Sparkles className="w-4 h-4" />
            </span>
            <span>{t("brand.name")}</span>
          </Link>
          <button
            type="button"
            onClick={onToggleCollapse}
            className="grid place-items-center w-8 h-8 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
            aria-label={t("nav.hideSidebar")}
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        {/* Action + Search + List */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3.5 min-h-0">
          <button
            type="button"
            onClick={handleNewChat}
            className="flex items-center gap-2.5 w-full px-3.5 py-2.5 rounded-[10px] bg-[var(--panel-elevated)] border border-[var(--border)] text-sm font-semibold text-[var(--ink)] hover:bg-[var(--hover)] active:scale-[0.985] transition-all cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{t("nav.newChat")}</span>
          </button>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--placeholder)] pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("nav.searchPlaceholder")}
              className="w-full pl-8 pr-3 py-1.5 rounded-[10px] border border-[var(--border)] bg-transparent text-sm text-[var(--ink)] placeholder:text-[var(--placeholder)] focus:border-[var(--accent)]"
            />
          </div>

          <nav className="space-y-4">
            {groups.today.length > 0 && (
              <div>
                <p className="px-1 text-[11px] font-semibold text-[var(--placeholder)] mb-1">
                  {t("nav.today")}
                </p>
                <div className="space-y-0.5">
                  {groups.today.map((s) => (
                    <SessionLink
                      key={s.id}
                      session={s}
                      active={pathname === `/c/${s.id}` || pathname === `/c/${s.slug}`}
                      onClick={onCloseMobile}
                    />
                  ))}
                </div>
              </div>
            )}

            {groups.yesterday.length > 0 && (
              <div>
                <p className="px-1 text-[11px] font-semibold text-[var(--placeholder)] mb-1">
                  {t("nav.yesterday")}
                </p>
                <div className="space-y-0.5">
                  {groups.yesterday.map((s) => (
                    <SessionLink
                      key={s.id}
                      session={s}
                      active={pathname === `/c/${s.id}` || pathname === `/c/${s.slug}`}
                      onClick={onCloseMobile}
                    />
                  ))}
                </div>
              </div>
            )}

            {groups.week.length > 0 && (
              <div>
                <p className="px-1 text-[11px] font-semibold text-[var(--placeholder)] mb-1">
                  {t("nav.last7Days")}
                </p>
                <div className="space-y-0.5">
                  {groups.week.map((s) => (
                    <SessionLink
                      key={s.id}
                      session={s}
                      active={pathname === `/c/${s.id}` || pathname === `/c/${s.slug}`}
                      onClick={onCloseMobile}
                    />
                  ))}
                </div>
              </div>
            )}

            {filtered.length === 0 && (
              <p className="px-1 text-xs text-[var(--placeholder)]">
                {t("nav.emptyHistory")}
              </p>
            )}
          </nav>
        </div>

        {/* Footer: quota + account */}
        <div className="p-3.5 border-t border-[var(--border)] space-y-3">
          {!user && loading ? (
            <AccountSkeleton />
          ) : !user ? (
            <Link
              href="/login"
              onClick={onCloseMobile}
              className="flex items-center justify-center w-full py-2 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-sm font-semibold text-[var(--accent-text)] transition-colors"
            >
              {t("nav.login")}
            </Link>
          ) : (
          <div
            aria-busy={stale}
            className={cn(
              "space-y-3 transition-[filter,opacity] duration-300",
              stale && "blur-[2px] opacity-60 pointer-events-none select-none"
            )}
          >
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-[var(--muted)]">{t("nav.monthlyQuota")}</span>
              <span className="font-semibold text-[var(--ink)]">
                {user.quota.limitTokens === null ? "∞" : `${user.quota.usedPercent}%`}
              </span>
            </div>
            <div className="h-1 rounded-full bg-[var(--border)] overflow-hidden">
              <div
                className="h-full bg-[var(--accent)] rounded-full transition-all"
                style={{ width: `${user.quota.usedPercent}%` }}
              />
            </div>
            <p className="text-[11px] text-[var(--placeholder)] mt-1.5">
              {t("nav.quotaResetsIn", { days: user.quota.resetInDays })}
            </p>
          </div>

          <div className="flex items-center gap-2.5 p-1.5 rounded-[10px] hover:bg-[var(--hover)] transition-colors">
            <span className="grid place-items-center w-7 h-7 rounded-full bg-[var(--accent)] text-[var(--accent-text)] text-[11px] font-bold">
              {user.initials}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-[var(--ink)] truncate">
                {user.name}
              </p>
              <p className="text-[11px] text-[var(--placeholder)] truncate">
                {user.planLabel}
              </p>
            </div>

            <Popover
              side="top"
              align="end"
              className="w-[200px]"
              trigger={
                <button
                  type="button"
                  className="p-1 rounded-[6px] text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer"
                  aria-label={t("nav.accountOptions")}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              }
            >
              <div className="space-y-0.5">
                <Link
                  href="/settings"
                  onClick={onCloseMobile}
                  className="glass-hover flex items-center gap-2 w-full px-2.5 py-1.5 rounded-[6px] text-xs font-medium text-[var(--ink)]"
                >
                  <SettingsIcon className="w-3.5 h-3.5 text-[var(--muted)]" />
                  <span>{t("nav.settings")}</span>
                </Link>

                <button
                  type="button"
                  onClick={() => setLocale(locale === "id" ? "en" : "id")}
                  className="glass-hover flex items-center justify-between w-full px-2.5 py-1.5 rounded-[6px] text-xs font-medium text-[var(--ink)] cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-[var(--muted)]" />
                    <span>{locale === "id" ? "Bahasa: ID" : "Language: EN"}</span>
                  </span>
                  <span className="text-[10px] uppercase font-bold text-[var(--muted)]">
                    {locale}
                  </span>
                </button>

                <DropdownSeparator />

                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-[6px] text-xs font-medium text-red-500 hover:bg-red-500/10 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{t("nav.logout")}</span>
                </button>
              </div>
            </Popover>
          </div>
          </div>
          )}
        </div>
      </aside>
    </>
  );
}

/** Placeholder with the same footprint as the quota + account block, shown before any data exists. */
function AccountSkeleton() {
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

function SessionLink({
  session,
  active,
  onClick,
}: {
  session: Session;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Link
      href={`/c/${session.slug || session.id}`}
      onClick={onClick}
      className={cn(
        "block w-full text-left px-2.5 py-2 rounded-[6px] text-[13.5px] truncate transition-colors",
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent)] font-medium"
          : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
      )}
      title={session.title}
    >
      {session.title}
    </Link>
  );
}
