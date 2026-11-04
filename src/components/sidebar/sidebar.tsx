"use client";

import React, { useState, useMemo, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Plus,
  Search,
  Pin,
} from "lucide-react";
import { SidebarAccountCard, AccountSkeleton } from "./sidebar-account";
import { SidebarSessionsSkeleton } from "./sidebar-skeleton";
import { SidebarHeader } from "./sidebar-header";
import { PanelResizeHandle } from "@/components/ui/panel-resize-handle";
import { CollapsibleGroup } from "./collapsible-group";
import { SessionItem } from "./session-item";
import { ProjectGroup } from "./project-group";
import { SidebarModals } from "./sidebar-modals";
import { useProjects, dispatchProjectsUpdated } from "@/hooks/use-projects";
import { useToast } from "@/providers/toast-provider";
import type { ProjectDto } from "@/lib/projects/types";
import { useResizablePanel } from "@/hooks/use-resizable-panel";
import { useI18n } from "@/providers/i18n-provider";
import { useAccount } from "@/providers/account-provider";
import { cn } from "@/lib/cn";
import type { Session, SessionGroupKey } from "@/types";
import {
  EMPTY_COLLAPSED,
  subscribeCollapsedGroups,
  readCollapsedGroups,
  updateCollapsedGroup,
  ensureGroupExpanded,
} from "./sidebar-groups-storage";

export { ensureGroupExpanded };

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
  onShareSession?: (session: Session) => void;
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
  onShareSession,
}: SidebarProps) {
  const { t, locale, setLocale } = useI18n();
  const { user, loading, stale, logout } = useAccount();
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const [query, setQuery] = useState("");

  const {
    projects,
    isLoading: isLoadingProjects,
    createProject,
    renameProject,
    togglePinProject,
    deleteProject,
  } = useProjects();

  const [isCreateProjectOpen, setIsCreateProjectOpen] = useState(false);
  const [projectToRename, setProjectToRename] = useState<ProjectDto | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<ProjectDto | null>(null);
  const [projectToShare, setProjectToShare] = useState<ProjectDto | null>(null);
  const [pendingChatToMoveAfterCreate, setPendingChatToMoveAfterCreate] = useState<string | null>(null);
  const [chatToLock, setChatToLock] = useState<string | null>(null);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [pinModalMode, setPinModalMode] = useState<"create" | "verify">("create");
  const [pendingTargetChatId, setPendingTargetChatId] = useState<string | null>(null);
  const [pendingTargetLockAction, setPendingTargetLockAction] = useState<boolean>(true);

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
    // Only standalone sessions (not attached to any project) appear in main date history
    const standalone = sessions.filter((s) => !s.projectId);
    if (!q) return standalone;
    return standalone.filter((s) => s.title.toLowerCase().includes(q));
  }, [sessions, query]);

  async function handleCreateProjectSubmit(name: string) {
    const created = await createProject(name);
    if (created) {
      if (pendingChatToMoveAfterCreate) {
        await handleMoveChatToProject(pendingChatToMoveAfterCreate, created.id);
        setPendingChatToMoveAfterCreate(null);
      }
      onCloseMobile();
      router.push(`/project/${created.id}`);
      return true;
    }
    return false;
  }

  async function handleConfirmRenameProject(newName: string) {
    if (!projectToRename) return;
    const ok = await renameProject(projectToRename.id, newName);
    if (ok) setProjectToRename(null);
  }

  async function handleConfirmDeleteProject(cascade: boolean) {
    if (!projectToDelete) return;
    const ok = await deleteProject(projectToDelete.id, cascade);
    if (ok) {
      if (pathname.startsWith(`/project/${projectToDelete.id}`)) {
        router.push("/");
      }
      setProjectToDelete(null);
    }
  }

  async function handleMoveChatToProject(chatId: string, targetProjectId: string | null) {
    try {
      const res = await fetch(`/api/v1/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: targetProjectId }),
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Failed to move chat");
      dispatchProjectsUpdated();
      window.dispatchEvent(new CustomEvent("devnuby:sessions-updated"));
      toast(targetProjectId ? "Dipindahkan ke proyek" : "Dikeluarkan dari proyek");
    } catch {
      toast("Gagal memindahkan percakapan");
    }
  }

  async function handleInitiateLockChat(chatId: string, nextLocked: boolean) {
    if (nextLocked) {
      setPendingTargetChatId(chatId);
      setPendingTargetLockAction(true);
      setChatToLock(chatId);
    } else {
      setPendingTargetChatId(chatId);
      setPendingTargetLockAction(false);
      setPinModalMode("verify");
      setIsPinModalOpen(true);
    }
  }

  async function handleConfirmLockChat() {
    setChatToLock(null);
    try {
      const res = await fetch("/api/v1/user/pin", { credentials: "same-origin" });
      const json = await res.json().catch(() => ({}));
      const hasPin = Boolean(json.data?.hasPin);
      setPinModalMode(hasPin ? "verify" : "create");
      setIsPinModalOpen(true);
    } catch {
      setPinModalMode("create");
      setIsPinModalOpen(true);
    }
  }

  async function handlePinSuccess() {
    if (!pendingTargetChatId) return;
    const nextLocked = pendingTargetLockAction;
    try {
      const res = await fetch(`/api/v1/chats/${pendingTargetChatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isLocked: nextLocked }),
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Failed to lock chat");
      dispatchProjectsUpdated();
      window.dispatchEvent(new CustomEvent("devnuby:sessions-updated"));
      toast(nextLocked ? "Obrolan dikunci" : "Kunci obrolan dibuka");
    } catch {
      toast("Gagal mengubah status kunci");
    } finally {
      setPendingTargetChatId(null);
    }
  }

  function handleCreateNewProjectForChat(chatId: string) {
    setPendingChatToMoveAfterCreate(chatId);
    setIsCreateProjectOpen(true);
  }

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
        <SidebarHeader onToggleCollapse={onToggleCollapse} />

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
            {/* Project Workspaces Group (Fase 2) */}
            <ProjectGroup
              projects={projects}
              isLoading={isLoadingProjects}
              onNavigate={onCloseMobile}
              onCreateProject={() => {
                setPendingChatToMoveAfterCreate(null);
                setIsCreateProjectOpen(true);
              }}
              onRenameProject={(p) => setProjectToRename(p)}
              onTogglePinProject={(p) => togglePinProject(p.id, !p.isPinned)}
              onDeleteProject={(p) => setProjectToDelete(p)}
              onShareProject={(p) => setProjectToShare(p)}
              onRenameChat={(chatId, currentTitle) => {
                const s = sessions.find((x) => x.id === chatId);
                if (s) onRenameSession(s);
                else onRenameSession({ id: chatId, title: currentTitle } as Session);
              }}
              onTogglePinChat={(chatId) => {
                const s = sessions.find((x) => x.id === chatId);
                if (s) onTogglePinSession(s);
              }}
              onShareChat={(chatId) => {
                const s = sessions.find((x) => x.id === chatId);
                if (s && onShareSession) onShareSession(s);
              }}
              onArchiveChat={(chatId) => {
                const s = sessions.find((x) => x.id === chatId);
                if (s) onArchiveSession(s);
              }}
              onDeleteChat={(chatId, title) => {
                const s = sessions.find((x) => x.id === chatId);
                if (s) onDeleteSession(s);
                else onDeleteSession({ id: chatId, title } as Session);
              }}
              onMoveChatToProject={handleMoveChatToProject}
              onCreateNewProjectForChat={handleCreateNewProjectForChat}
              onLockChat={handleInitiateLockChat}
            />

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
                            projects={projects}
                            active={
                              pathname === `/c/${s.id}` ||
                              (s.slug ? pathname === `/c/${s.slug}` : false)
                            }
                            onNavigate={onCloseMobile}
                            onRename={onRenameSession}
                            onTogglePin={handlePinFromSidebar}
                            onArchive={onArchiveSession}
                            onDelete={onDeleteSession}
                            onLock={(session) => handleInitiateLockChat(session.id, !session.isLocked)}
                            onMoveToProject={handleMoveChatToProject}
                            onCreateNewProjectForChat={handleCreateNewProjectForChat}
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
            <GuestLogin />
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

      {/* Sidebar Modals */}
      <SidebarModals
        isCreateProjectOpen={isCreateProjectOpen}
        onCloseCreateProject={() => {
          setIsCreateProjectOpen(false);
          setPendingChatToMoveAfterCreate(null);
        }}
        onCreateProjectSubmit={handleCreateProjectSubmit}
        projectToRename={projectToRename}
        onCloseRenameProject={() => setProjectToRename(null)}
        onConfirmRenameProject={handleConfirmRenameProject}
        projectToDelete={projectToDelete}
        onCloseDeleteProject={() => setProjectToDelete(null)}
        onConfirmDeleteProject={handleConfirmDeleteProject}
        projectToShare={projectToShare}
        onCloseShareProject={() => setProjectToShare(null)}
        chatToLock={chatToLock}
        onCloseConfirmLockChat={() => setChatToLock(null)}
        onConfirmLockChat={handleConfirmLockChat}
        isPinModalOpen={isPinModalOpen}
        pinModalMode={pinModalMode}
        onClosePinModal={() => setIsPinModalOpen(false)}
        onPinSuccess={handlePinSuccess}
      />
    </>
  );
}

function GuestLogin() {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/authenticate`);
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      }}
      className="flex items-center justify-center w-full py-2 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-sm font-semibold text-[var(--accent-text)] transition-colors cursor-pointer"
    >
      {t("nav.login")}
    </button>
  );
}
