"use client";

import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import {
  FileSearch,
  LayoutGrid,
  Library,
  List,
  PanelLeft,
  Plus,
  RotateCw,
  Search,
  Shapes,
  Upload,
  X,
  Files,
} from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { CustomSelect } from "@/components/ui/custom-select";
import { ImagePreviewModal, type PreviewImageTarget } from "@/components/modals/image-preview-modal";
import { useI18n } from "@/providers/i18n-provider";
import { useAccount } from "@/providers/account-provider";
import { formatFileSize } from "@/lib/files/policy";
import { queueFilePreviewForChat } from "@/lib/files/preview-events";
import { cn } from "@/lib/cn";
import type { LibraryFileDto, LibraryResponseDto } from "@/lib/library/types";
import {
  LibraryCardSkeleton,
  LibraryFileCard,
  LibraryFileRow,
  type LibraryFileActions,
} from "./library-file-card";
import {
  DATE_GROUP_ORDER,
  LIBRARY_KINDS,
  chatHref,
  dateGroupOf,
  libraryKindOf,
  sortFiles,
  type LibraryDateGroup,
  type LibraryKind,
  type LibrarySort,
  type LibraryTab,
  type LibraryViewMode,
} from "./library-utils";

const VIEW_STORAGE_KEY = "devnuby-library-view";
const VIEW_EVENT = "devnuby:library-view";

function subscribeView(cb: () => void) {
  window.addEventListener(VIEW_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(VIEW_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function readView(): LibraryViewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function writeView(mode: LibraryViewMode) {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, mode);
  } catch {}
  window.dispatchEvent(new Event(VIEW_EVENT));
}

const NO_SCROLLBAR = "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export interface LibraryViewProps {
  onToggleSidebar: () => void;
}

export function LibraryView({ onToggleSidebar }: LibraryViewProps) {
  const { t } = useI18n();
  const { user, loading: accountLoading } = useAccount();
  const router = useRouter();

  const [data, setData] = useState<LibraryResponseDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<LibraryTab>("all");
  const [kind, setKind] = useState<LibraryKind>("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<LibrarySort>("newest");
  const view = useSyncExternalStore(subscribeView, readView, () => "grid" as LibraryViewMode);
  const [previewImage, setPreviewImage] = useState<PreviewImageTarget | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const load = useCallback(() => setReloadKey((k) => k + 1), []);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/v1/me/library", { credentials: "same-origin", cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error?.message || "");
        if (!active) return;
        setData(json.data as LibraryResponseDto);
        setError(null);
      } catch (err) {
        if (active) setError((err instanceof Error && err.message) || "loadFailed");
      } finally {
        if (active) setIsLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, reloadKey]);

  // New uploads or AI files elsewhere in the app refresh the library
  useEffect(() => {
    window.addEventListener("devnuby:files-updated", load);
    return () => window.removeEventListener("devnuby:files-updated", load);
  }, [load]);

  const files = useMemo(() => data?.files ?? [], [data]);

  const tabCounts = useMemo(
    () => ({
      all: files.length,
      generated: files.filter((f) => f.source === "generated").length,
      upload: files.filter((f) => f.source === "upload").length,
    }),
    [files]
  );

  const totalBytes = useMemo(() => files.reduce((sum, f) => sum + f.sizeBytes, 0), [files]);

  const tabFiles = useMemo(
    () => (tab === "all" ? files : files.filter((f) => f.source === tab)),
    [files, tab]
  );

  const kindCounts = useMemo(() => {
    const counts: Record<Exclude<LibraryKind, "all">, number> = {
      document: 0,
      image: 0,
      spreadsheet: 0,
      presentation: 0,
      code: 0,
      other: 0,
    };
    for (const f of tabFiles) counts[libraryKindOf(f)] += 1;
    return counts;
  }, [tabFiles]);

  const visibleFiles = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = tabFiles.filter((f) => {
      if (kind !== "all" && libraryKindOf(f) !== kind) return false;
      if (!q) return true;
      return (
        f.displayName.toLowerCase().includes(q) ||
        f.chat.title.toLowerCase().includes(q) ||
        (f.chat.projectName ?? "").toLowerCase().includes(q)
      );
    });
    return sortFiles(filtered, sort);
  }, [tabFiles, kind, query, sort]);

  // Newest/oldest read best grouped by when the file was made
  const sections = useMemo(() => {
    if (sort !== "newest" && sort !== "oldest") {
      return [{ key: "all" as const, files: visibleFiles }];
    }
    const map = new Map<LibraryDateGroup, LibraryFileDto[]>();
    const now = new Date();
    for (const f of visibleFiles) {
      const g = dateGroupOf(f.createdAt, now);
      const list = map.get(g) ?? [];
      list.push(f);
      map.set(g, list);
    }
    const order = sort === "newest" ? DATE_GROUP_ORDER : [...DATE_GROUP_ORDER].reverse();
    return order.filter((g) => map.has(g)).map((g) => ({ key: g, files: map.get(g)! }));
  }, [visibleFiles, sort]);

  const actions: LibraryFileActions = useMemo(
    () => ({
      onOpen: (file) => {
        if (file.isImage) {
          setPreviewImage({ url: file.url, title: file.displayName });
          return;
        }
        queueFilePreviewForChat(file.chat.id, { ...file, source: file.source === "upload" ? "upload" : "tool" });
        router.push(chatHref(file));
      },
      onOpenChat: (file) => router.push(chatHref(file)),
    }),
    [router]
  );

  function changeTab(next: LibraryTab) {
    setTab(next);
    setKind("all");
  }

  const hasFilters = kind !== "all" || query.trim().length > 0;
  function resetFilters() {
    setKind("all");
    setQuery("");
  }

  const tabs: { key: LibraryTab; label: string; icon: React.ReactNode }[] = [
    { key: "all", label: t("library.tabAll"), icon: <Files className="w-3.5 h-3.5" /> },
    { key: "generated", label: t("library.tabGenerated"), icon: <Shapes className="w-3.5 h-3.5" /> },
    { key: "upload", label: t("library.tabUploaded"), icon: <Upload className="w-3.5 h-3.5" /> },
  ];

  const isGuest = !user && !accountLoading;
  const showSkeleton = (isLoading && !data) || (accountLoading && !user);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Top bar, same rhythm as the chat topbar */}
      <header className="flex items-center gap-3 h-14 px-3 sm:px-4.5 border-b border-[var(--border)] bg-[var(--panel)] shrink-0">
        <Tooltip content={t("nav.showSidebar")} side="bottom" align="start">
          <button
            type="button"
            onClick={onToggleSidebar}
            className="grid place-items-center w-8 h-8 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
            aria-label={t("nav.showSidebar")}
          >
            <PanelLeft className="w-4 h-4" />
          </button>
        </Tooltip>
        <div className="flex items-center gap-2 min-w-0 text-[15px] font-semibold text-[var(--ink)]">
          <Library className="w-4 h-4 text-[var(--muted)] shrink-0" />
          <span className="truncate">{t("library.title")}</span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-10 pt-6 sm:pt-9 pb-16">
          {/* Heading */}
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
            <div className="min-w-0">
              <h1 className="text-[22px] sm:text-[26px] font-semibold tracking-tight text-[var(--ink)]">
                {t("library.title")}
              </h1>
              <p className="mt-1 text-[13.5px] text-[var(--muted)] max-w-xl leading-relaxed">
                {t("library.subtitle")}
              </p>
            </div>
            {data && files.length > 0 && (
              <div className="flex items-center gap-2 shrink-0">
                <StatPill value={String(files.length)} label={t("library.statFiles")} />
                <StatPill value={formatFileSize(totalBytes)} label={t("library.statSize")} />
              </div>
            )}
          </div>

          {isGuest ? (
            <EmptyState
              icon={<Library className="w-6 h-6" />}
              title={t("library.guestTitle")}
              body={t("library.guestBody")}
              action={
                <button
                  type="button"
                  onClick={() => {
                    window.history.replaceState(
                      null,
                      "",
                      `${window.location.pathname}${window.location.search}#/authenticate`
                    );
                    window.dispatchEvent(new HashChangeEvent("hashchange"));
                  }}
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[13px] font-semibold text-[var(--accent-text)] transition-colors cursor-pointer"
                >
                  {t("nav.login")}
                </button>
              }
            />
          ) : (
            <>
              {/* Sticky controls: tabs, search, sort, view, type chips */}
              <div className="sticky top-0 z-20 pt-1 pb-3 bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] backdrop-blur-md">
                <div
                  role="tablist"
                  aria-label={t("library.title")}
                  className={cn("flex items-center gap-1 overflow-x-auto", NO_SCROLLBAR)}
                >
                  {tabs.map((tb) => {
                    const active = tab === tb.key;
                    return (
                      <button
                        key={tb.key}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => changeTab(tb.key)}
                        className={cn(
                          "flex items-center gap-1.5 px-3 sm:px-3.5 h-9 rounded-[10px] text-[13px] whitespace-nowrap transition-colors cursor-pointer select-none shrink-0",
                          active
                            ? "bg-[var(--panel)] border border-[var(--border)] text-[var(--ink)] font-semibold shadow-xs"
                            : "border border-transparent text-[var(--muted)] font-medium hover:text-[var(--ink)] hover:bg-[var(--hover)]"
                        )}
                      >
                        {tb.icon}
                        <span>{tb.label}</span>
                        {data && (
                          <span
                            className={cn(
                              "min-w-[20px] px-1.5 py-px rounded-full text-[10.5px] font-semibold tabular-nums text-center",
                              active
                                ? "bg-[var(--accent)] text-[var(--accent-text)]"
                                : "bg-[var(--hover)] text-[var(--muted)]"
                            )}
                          >
                            {tabCounts[tb.key]}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-2 mt-3">
                  <div className="relative flex-1 min-w-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--placeholder)] pointer-events-none" />
                    <input
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t("library.searchPlaceholder")}
                      className="w-full h-9 pl-9 pr-8 rounded-[10px] border border-[var(--border)] bg-[var(--panel)] text-[13px] text-[var(--ink)] placeholder:text-[var(--placeholder)] focus:border-[var(--accent)] [&::-webkit-search-cancel-button]:hidden"
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={() => setQuery("")}
                        aria-label={t("library.clearSearch")}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 grid place-items-center w-6 h-6 rounded-[6px] text-[var(--placeholder)] hover:text-[var(--ink)] hover:bg-[var(--hover)] cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 sm:shrink-0">
                    <CustomSelect<LibrarySort>
                      value={sort}
                      onChange={setSort}
                      align="right"
                      className="flex-1 sm:flex-none sm:w-[168px]"
                      options={[
                        { value: "newest", label: t("library.sortNewest") },
                        { value: "oldest", label: t("library.sortOldest") },
                        { value: "name", label: t("library.sortName") },
                        { value: "size", label: t("library.sortSize") },
                      ]}
                    />
                    <div className="flex items-center p-0.5 rounded-[10px] border border-[var(--border)] bg-[var(--panel)] shrink-0">
                      <ViewButton
                        active={view === "grid"}
                        label={t("library.viewGrid")}
                        onClick={() => writeView("grid")}
                        icon={<LayoutGrid className="w-4 h-4" />}
                      />
                      <ViewButton
                        active={view === "list"}
                        label={t("library.viewList")}
                        onClick={() => writeView("list")}
                        icon={<List className="w-4 h-4" />}
                      />
                    </div>
                  </div>
                </div>

                {tabFiles.length > 0 && (
                  <div className={cn("flex items-center gap-1.5 mt-3 overflow-x-auto", NO_SCROLLBAR)}>
                    <KindChip active={kind === "all"} label={t("library.kindAll")} count={tabFiles.length} onClick={() => setKind("all")} />
                    {LIBRARY_KINDS.filter((k) => kindCounts[k] > 0).map((k) => (
                      <KindChip
                        key={k}
                        active={kind === k}
                        label={t(`library.kind.${k}`)}
                        count={kindCounts[k]}
                        onClick={() => setKind(kind === k ? "all" : k)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Content */}
              <div className="mt-2">
                {showSkeleton ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <LibraryCardSkeleton key={i} />
                    ))}
                  </div>
                ) : error && !data ? (
                  <EmptyState
                    icon={<RotateCw className="w-6 h-6" />}
                    title={t("library.loadFailed")}
                    body={error === "loadFailed" ? t("library.retryHint") : error}
                    action={
                      <button
                        type="button"
                        onClick={() => {
                          setIsLoading(true);
                          load();
                        }}
                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[10px] border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--hover)] text-[13px] font-semibold text-[var(--ink)] transition-colors cursor-pointer"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                        {t("library.retry")}
                      </button>
                    }
                  />
                ) : tabFiles.length === 0 ? (
                  <EmptyState
                    icon={
                      tab === "generated" ? (
                        <Shapes className="w-6 h-6" />
                      ) : tab === "upload" ? (
                        <Upload className="w-6 h-6" />
                      ) : (
                        <Library className="w-6 h-6" />
                      )
                    }
                    title={t(`library.empty.${tab}.title`)}
                    body={t(`library.empty.${tab}.body`)}
                    action={
                      <button
                        type="button"
                        onClick={() => router.push("/")}
                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[13px] font-semibold text-[var(--accent-text)] transition-colors cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {t("library.startChat")}
                      </button>
                    }
                  />
                ) : visibleFiles.length === 0 ? (
                  <EmptyState
                    icon={<FileSearch className="w-6 h-6" />}
                    title={t("library.noResultsTitle")}
                    body={t("library.noResultsBody")}
                    action={
                      hasFilters ? (
                        <button
                          type="button"
                          onClick={resetFilters}
                          className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[10px] border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--hover)] text-[13px] font-semibold text-[var(--ink)] transition-colors cursor-pointer"
                        >
                          {t("library.resetFilters")}
                        </button>
                      ) : null
                    }
                  />
                ) : (
                  <div className="space-y-7">
                    {sections.map((section) => (
                      <section key={section.key} aria-label={section.key === "all" ? undefined : t(`library.group.${section.key}`)}>
                        {section.key !== "all" && (
                          <h2 className="flex items-center gap-2 mb-3 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[var(--placeholder)]">
                            <span>{t(`library.group.${section.key}`)}</span>
                            <span className="h-px flex-1 bg-[var(--border)]" />
                            <span className="tabular-nums normal-case tracking-normal font-medium">{section.files.length}</span>
                          </h2>
                        )}
                        {view === "grid" ? (
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4">
                            {section.files.map((f) => (
                              <LibraryFileCard key={f.id} file={f} actions={actions} />
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-[14px] border border-[var(--border)] bg-[var(--panel)] p-1 sm:p-1.5">
                            <div className="hidden md:grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.5fr)_84px_96px_40px] gap-3 px-3 pt-1.5 pb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--placeholder)] border-b border-[var(--border)] mb-1">
                              <span>{t("library.colName")}</span>
                              <span>{t("library.colChat")}</span>
                              <span>{t("library.colSize")}</span>
                              <span>{t("library.colDate")}</span>
                              <span />
                            </div>
                            {section.files.map((f) => (
                              <LibraryFileRow key={f.id} file={f} actions={actions} />
                            ))}
                          </div>
                        )}
                      </section>
                    ))}

                    {data?.truncated && (
                      <p className="text-center text-[12px] text-[var(--placeholder)]">{t("library.truncated")}</p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
    </div>
  );
}

function StatPill({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-baseline gap-1.5 px-3 h-8 rounded-[10px] border border-[var(--border)] bg-[var(--panel)]">
      <span className="text-[13px] font-semibold text-[var(--ink)] tabular-nums self-center">{value}</span>
      <span className="text-[11.5px] text-[var(--muted)] self-center">{label}</span>
    </div>
  );
}

function ViewButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label} side="bottom" align="end">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "grid place-items-center w-8 h-[30px] rounded-[8px] transition-colors cursor-pointer",
          active ? "bg-[var(--hover)] text-[var(--ink)]" : "text-[var(--placeholder)] hover:text-[var(--ink)]"
        )}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

function KindChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 h-7 px-3 rounded-full border text-[12px] whitespace-nowrap transition-colors cursor-pointer shrink-0",
        active
          ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-text)] font-semibold"
          : "bg-[var(--panel)] border-[var(--border)] text-[var(--muted)] font-medium hover:text-[var(--ink)] hover:bg-[var(--hover)]"
      )}
    >
      {label}
      <span className={cn("tabular-nums text-[11px]", active ? "opacity-80" : "text-[var(--placeholder)]")}>{count}</span>
    </button>
  );
}

function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 sm:py-20 px-6 rounded-[16px] border border-dashed border-[var(--border)]">
      <div className="grid place-items-center w-14 h-14 rounded-[16px] bg-[var(--panel)] border border-[var(--border)] text-[var(--muted)] shadow-[0_8px_24px_-14px_rgba(16,24,40,0.35)]">
        {icon}
      </div>
      <p className="mt-4 text-[15px] font-semibold text-[var(--ink)]">{title}</p>
      <p className="mt-1.5 text-[13px] text-[var(--muted)] max-w-sm leading-relaxed">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
