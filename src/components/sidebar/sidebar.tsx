"use client";

import React, { useState, useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  PanelLeftClose,
  Plus,
  Search,
  Pin,
} from "lucide-react";
import { SidebarAccountCard, AccountSkeleton } from "./sidebar-account";
import { DevnubyWordmark } from "@/components/brand/devnuby-logo";
import { Tooltip } from "@/components/ui/tooltip";
import { PanelResizeHandle } from "@/components/ui/panel-resize-handle";
import { CollapsibleGroup } from "./collapsible-group";
import { SessionItem } from "./session-item";
import { useResizablePanel } from "@/hooks/use-resizable-panel";
import { useI18n } from "@/providers/i18n-provider";
import { useAccount } from "@/providers/account-provider";
import { getLocalStorage, setLocalStorage } from "@/lib/storage";
import { cn } from "@/lib/cn";
import type { Session, SessionGroupKey, UserProfile } from "@/types";

const COLLAPSED_GROUPS_KEY = "devnuby-collapsed-groups";
const EMPTY_COLLAPSED: Partial<Record<SessionGroupKey, boolean>> = {};
let cachedCollapsedRaw: string | null = null;
let cachedCollapsedObj: Partial<Record<SessionGroupKey, boolean>> = EMPTY_COLLAPSED;
const groupListeners = new Set<() => void>();

function subscribeCollapsedGroups(listener: () => void) {
  groupListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    groupListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function readCollapsedGroups(): Partial<Record<SessionGroupKey, boolean>> {
  if (typeof window === "undefined") return EMPTY_COLLAPSED;
  try {
    const raw = window.localStorage.getItem(COLLAPSED_GROUPS_KEY);
    if (raw === cachedCollapsedRaw) return cachedCollapsedObj;
    cachedCollapsedRaw = raw;
    cachedCollapsedObj = raw ? JSON.parse(raw) : EMPTY_COLLAPSED;
    return cachedCollapsedObj;
  } catch {
    return EMPTY_COLLAPSED;
  }
}

function updateCollapsedGroup(key: SessionGroupKey, collapsed: boolean) {
  const current = getLocalStorage<Partial<Record<SessionGroupKey, boolean>>>(
    COLLAPSED_GROUPS_KEY,
    {}
  );
  const next = { ...current, [key]: collapsed };
  setLocalStorage(COLLAPSED_GROUPS_KEY, next);
  groupListeners.forEach((l) => l());
}

export function ensureGroupExpanded(key: SessionGroupKey) {
  const current = readCollapsedGroups();
  if (current[key]) {
    updateCollapsedGroup(key, false);
  }
}

export interface SidebarProps {
  sessions: Session[];
  isLoadingSessions?: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onRenameSession: (session: Session) => void;
  onTogglePinSession: (session: Session) => void;
  onArchiveSession: (session: Session) => void;
  onDeleteSession: (session: Session) => void;
}

export function Sidebar({
  sessions,
  isLoadingSessions = false,
  isCollapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
  onRenameSession,
  onTogglePinSession,
  onArchiveSession,
  onDeleteSession,
}: SidebarProps) {
  const { t, locale, setLocale } = useI18n();
  const { user, loading, stale, logout } = useAccount();
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");

  const {
    panelRef: sidebarPanelRef,
    width: sidebarWidth,
    isDragging: isResizingSidebar,
    handlePointerDown: handleSidebarResizeStart,
    resetWidth: resetSidebarWidth,
  } = useResizablePanel({
    defaultWidth: 272,
    minWidth: 220,
    maxWidth: 460,
    maxViewportRatio: 0.42,
    edge: "right",
    storageKey: "devnuby-sidebar-width",
    cssVar: "--sidebar-w",
  });

  const collapsedGroups = useSyncExternalStore(
    subscribeCollapsedGroups,
    readCollapsedGroups,
    () => EMPTY_COLLAPSED
  );

  const isSearching = query.trim().length > 0;

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
    const byRecent = (a: Session, b: Session) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

    const pinned = filtered.filter((s) => s.isPinned).sort(byRecent);
    const unpinned = filtered.filter((s) => !s.isPinned);

    return {
      pinned,
      today: unpinned.filter((s) => s.group === "today").sort(byRecent),
      yesterday: unpinned.filter((s) => s.group === "yesterday").sort(byRecent),
      week: unpinned.filter((s) => s.group === "week").sort(byRecent),
      earlier: unpinned.filter((s) => s.group === "earlier").sort(byRecent),
    };
  }, [filtered]);

  function handleNewChat() {
    onCloseMobile();
    router.push("/");
  }

  function handlePinFromSidebar(session: Session) {
    if (!session.isPinned && collapsedGroups.pinned) {
      updateCollapsedGroup("pinned", false);
    }
    onTogglePinSession(session);
  }

  function isGroupOpen(key: SessionGroupKey) {
    if (isSearching) return true;
    return !collapsedGroups[key];
  }

  function toggleGroup(key: SessionGroupKey) {
    updateCollapsedGroup(key, !collapsedGroups[key]);
  }

  const groupConfigs: Array<{
    key: SessionGroupKey;
    label: string;
    icon?: React.ReactNode;
    items: Session[];
  }> = [
    {
      key: "pinned",
      label: t("nav.pinned"),
      icon: <Pin className="w-3 h-3" />,
      items: groups.pinned,
    },
    { key: "today", label: t("nav.today"), items: groups.today },
    { key: "yesterday", label: t("nav.yesterday"), items: groups.yesterday },
    { key: "week", label: t("nav.last7Days"), items: groups.week },
    { key: "earlier", label: t("nav.earlier"), items: groups.earlier },
  ];

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
        ref={sidebarPanelRef}
        style={{ "--sidebar-w": `${sidebarWidth}px` } as React.CSSProperties}
        className={cn(
          "fixed inset-y-0 left-0 z-[95] flex w-[280px] shrink-0 flex-col border-r border-[var(--border)] bg-[var(--panel)] md:z-[90] md:translate-x-0",
          !isResizingSidebar &&
            "transition-[translate,width] duration-300 ease-[var(--ease-out)] motion-reduce:transition-none",
          isCollapsed
            ? "md:static md:w-0 md:border-r-0 md:pointer-events-none md:invisible overflow-hidden"
            : "md:relative md:w-[min(var(--sidebar-w),32vw)]",
          isResizingSidebar && "select-none",
          mobileOpen ? "translate-x-0" : "-translate-x-full pointer-events-none md:pointer-events-auto",
          !mobileOpen && "invisible md:visible"
        )}
      >
        {!isCollapsed && (
          <PanelResizeHandle
            edge="right"
            isDragging={isResizingSidebar}
            onPointerDown={handleSidebarResizeStart}
            onDoubleClick={resetSidebarWidth}
          />
        )}

        {/* Top brand + collapse button */}
        <div className="flex items-center justify-between gap-3 h-14 px-3.5 border-b border-[var(--border)] shrink-0">
          <Link href="/" className="flex items-center min-w-0" aria-label={t("brand.name")}>
            <DevnubyWordmark className="h-8 w-auto" />
          </Link>
          <Tooltip content={t("nav.hideSidebar")} side="bottom" align="end">
            <button
              type="button"
              onClick={onToggleCollapse}
              className="grid place-items-center w-8 h-8 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
              aria-label={t("nav.hideSidebar")}
            >
              <PanelLeftClose className="w-4 h-4" />
            </button>
          </Tooltip>
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

          <nav className="space-y-3">
            {isLoadingSessions && sessions.length === 0 ? (
              <SidebarSessionsSkeleton />
            ) : (
              <>
                {groupConfigs.map(
                  (grp) =>
                    grp.items.length > 0 && (
                      <CollapsibleGroup
                        key={grp.key}
                        label={grp.label}
                        icon={grp.icon}
                        isOpen={isGroupOpen(grp.key)}
                        onToggle={() => toggleGroup(grp.key)}
                      >
                        {grp.items.map((s) => (
                          <SessionItem
                            key={s.id}
                            session={s}
                            active={
                              pathname === `/c/${s.id}` ||
                              (s.slug ? pathname === `/c/${s.slug}` : false)
                            }
                            onNavigate={onCloseMobile}
                            onRename={onRenameSession}
                            onTogglePin={handlePinFromSidebar}
                            onArchive={onArchiveSession}
                            onDelete={onDeleteSession}
                          />
                        ))}
                      </CollapsibleGroup>
                    )
                )}

                {filtered.length === 0 && (
                  <p className="px-1 text-xs text-[var(--placeholder)]">
                    {t("nav.emptyHistory")}
                  </p>
                )}
              </>
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
            <SidebarAccountCard
              user={user}
              stale={stale}
              locale={locale}
              setLocale={setLocale}
              onCloseMobile={onCloseMobile}
              onLogout={handleLogout}
            />
          )}
        </div>
      </aside>
    </>
  );
}


/** Skeleton shown when chat sessions are being initially fetched from the server. */
function SidebarSessionsSkeleton() {
  return (
    <div className="space-y-4 animate-pulse px-1" aria-busy="true">
      <div>
        <div className="h-2.5 w-12 rounded bg-[var(--hover)] mb-2" />
        <div className="space-y-1.5">
          <div className="h-7 w-full rounded-[6px] bg-[var(--hover)]" />
          <div className="h-7 w-[85%] rounded-[6px] bg-[var(--hover)]" />
          <div className="h-7 w-[70%] rounded-[6px] bg-[var(--hover)]" />
        </div>
      </div>
      <div>
        <div className="h-2.5 w-16 rounded bg-[var(--hover)] mb-2" />
        <div className="space-y-1.5">
          <div className="h-7 w-[90%] rounded-[6px] bg-[var(--hover)]" />
          <div className="h-7 w-[75%] rounded-[6px] bg-[var(--hover)]" />
        </div>
      </div>
    </div>
  );
}
