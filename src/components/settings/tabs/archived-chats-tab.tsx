"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  ExternalLink,
  Search,
  Trash2,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import {
  mapApiSessionToDomain,
  type ApiSessionItem,
} from "@/lib/chat/client-mappers";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { useAccount } from "@/providers/account-provider";
import type { Session } from "@/types";

function formatArchiveDate(isoString: string, locale: "id" | "en"): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "id" ? "id-ID" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

export function ArchivedChatsTab() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { user } = useAccount();

  const [items, setItems] = useState<Session[]>([]);
  const [loading, setLoading] = useState(() => Boolean(user));
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deletingTarget, setDeletingTarget] = useState<Session | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;

    (async () => {
      try {
        const res = await fetch("/api/v1/chats?archived=true&limit=50", {
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const json = await res.json();
        const apiItems: ApiSessionItem[] = Array.isArray(json?.data) ? json.data : [];
        if (active) {
          setItems(apiItems.map(mapApiSessionToDomain));
        }
      } catch {
        // Ignore network failure
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [user]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((s) => s.title.toLowerCase().includes(q));
  }, [items, search]);

  async function handleUnarchive(chatId: string) {
    if (busyId) return;
    setBusyId(chatId);
    try {
      const res = await fetch(`/api/v1/chats/${chatId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: false }),
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Failed");
      setItems((prev) => prev.filter((s) => s.id !== chatId));
      toast(t("toast.chatUnarchived"));
    } catch {
      toast(t("toast.actionFailed"));
    } finally {
      setBusyId(null);
    }
  }

  async function handleConfirmDelete() {
    if (!deletingTarget || isDeleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/v1/chats/${deletingTarget.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Failed");
      setItems((prev) => prev.filter((s) => s.id !== deletingTarget.id));
      setDeletingTarget(null);
      toast(t("toast.chatDeleted"));
    } catch {
      toast(t("toast.actionFailed"));
    } finally {
      setIsDeleting(false);
    }
  }

  if (!user) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          {t("settings.archivedTab")}
        </h2>
        <p className="text-xs text-[var(--muted)]">{t("settings.archivedDesc")}</p>
        <Link
          href="/login"
          className="inline-block px-4 py-2 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-sm font-semibold text-[var(--accent-text)] transition-colors"
        >
          {t("nav.login")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          {t("settings.archivedTab")}
        </h2>
        <p className="text-xs text-[var(--muted)] mt-1">
          {t("settings.archivedDesc")}
        </p>
      </div>

      {/* Translucent glass search bar */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted)] z-10" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("settings.archivedSearch")}
          className="pl-9"
        />
      </div>

      {loading ? (
        <div className="divide-y divide-[var(--divider)] animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="py-3.5 flex items-center justify-between gap-4">
              <div className="space-y-2 flex-1">
                <div className="h-4 w-48 rounded bg-[var(--hover)]" />
                <div className="h-3 w-28 rounded bg-[var(--hover)]" />
              </div>
              <div className="h-8 w-24 rounded bg-[var(--hover)]" />
            </div>
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center py-12 px-4 rounded-[10px] border border-dashed border-[var(--border)]">
          <span className="grid place-items-center w-10 h-10 rounded-full bg-[var(--hover)] text-[var(--muted)] mb-2.5">
            <Archive className="w-4 h-4" />
          </span>
          <p className="text-sm text-[var(--muted)]">
            {search.trim() ? t("nav.emptyHistory") : t("settings.archivedEmpty")}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[var(--divider)] rounded-[10px] border border-[var(--border)] bg-[var(--panel-elevated)]/40">
          {filteredItems.map((chat) => {
            const dateStr = formatArchiveDate(chat.updatedAt, locale);
            const isBusy = busyId === chat.id;

            return (
              <div
                key={chat.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3.5 hover:bg-[var(--hover)]/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/c/${chat.id}`}
                    className="block text-sm font-semibold text-[var(--ink)] hover:text-[var(--accent)] truncate transition-colors"
                  >
                    {chat.title}
                  </Link>
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    {t("settings.archivedMessagesCount", {
                      count: chat.messageCount ?? 0,
                    })}
                    {dateStr ? ` · ${dateStr}` : ""}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Link
                    href={`/c/${chat.id}`}
                    className="inline-flex items-center justify-center gap-1.5 h-8 px-2.5 rounded-[var(--radius-sm)] text-[13px] font-medium text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>{t("settings.openChat")}</span>
                  </Link>

                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => handleUnarchive(chat.id)}
                  >
                    <ArchiveRestore className="w-3.5 h-3.5" />
                    <span>{t("settings.unarchive")}</span>
                  </Button>

                  <Tooltip content={t("sidebarChat.delete")} side="top" align="end">
                    <Button
                      variant="danger"
                      size="icon-sm"
                      disabled={isBusy}
                      onClick={() => setDeletingTarget(chat)}
                      aria-label={t("sidebarChat.delete")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmModal
        isOpen={Boolean(deletingTarget)}
        onClose={() => setDeletingTarget(null)}
        onConfirm={handleConfirmDelete}
        title={t("chatModals.deleteTitle")}
        description={t("chatModals.deleteDescription", {
          title: deletingTarget?.title ?? "",
        })}
        confirmLabel={isDeleting ? t("chatModals.deleting") : t("chatModals.deleteConfirm")}
        cancelLabel={t("chatModals.cancel")}
        variant="danger"
        loading={isDeleting}
      />
    </div>
  );
}
