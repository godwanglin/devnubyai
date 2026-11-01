"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { ConfirmModal } from "@/components/modals/confirm-modal";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { cn } from "@/lib/cn";
import { PROMPT_PLACEHOLDERS, type SystemPromptDto } from "@/lib/chat/system-prompts-shared";
import { SystemPromptModal } from "./system-prompt-modal";
import { DataTablePagination } from "@/components/ui/data-table-pagination";

export function SystemPromptsTab() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [prompts, setPrompts] = useState<SystemPromptDto[] | null>(null);
  const [editing, setEditing] = useState<SystemPromptDto | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deleting, setDeleting] = useState<SystemPromptDto | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Pagination state (default 10)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/system-prompts", { credentials: "same-origin" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error?.message);
      setPrompts(json.data.prompts);
    } catch (err) {
      setPrompts((prev) => prev ?? []);
      toast(err instanceof Error && err.message ? err.message : t("admin.systemPrompts.loadFailed"));
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggle(prompt: SystemPromptDto) {
    setTogglingId(prompt.id);
    try {
      const res = await fetch(`/api/v1/admin/system-prompts/${prompt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ isActive: !prompt.isActive }),
      });
      if (!res.ok) throw new Error();
      await load();
    } catch {
      toast(t("admin.systemPrompts.saveFailed"));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleConfirmDelete() {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/v1/admin/system-prompts/${deleting.id}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error();
      setDeleting(null);
      await load();
      toast(t("admin.systemPrompts.deleted"));
    } catch {
      toast(t("admin.systemPrompts.saveFailed"));
    } finally {
      setIsDeleting(false);
    }
  }

  const displayedPrompts = (prompts ?? []).slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--ink)]">{t("admin.systemPrompts.title")}</h2>
          <p className="text-xs text-[var(--muted)]">{t("admin.systemPrompts.description")}</p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setIsModalOpen(true);
          }}
        >
          <Plus className="w-4 h-4" />
          {t("admin.systemPrompts.add")}
        </Button>
      </div>

      {prompts === null ? (
        <div className="flex items-center py-6 text-[var(--muted)]">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : prompts.length === 0 ? (
        <div className="rounded-[12px] border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
          {t("admin.systemPrompts.empty")}
        </div>
      ) : (
        <div className="space-y-2">
          {displayedPrompts.map((prompt) => (
            <div
              key={prompt.id}
              className={cn(
                "rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-3.5 transition-opacity",
                !prompt.isActive && "opacity-60"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-[var(--muted)]">#{prompt.sortOrder}</span>
                    <p className="text-sm font-medium text-[var(--ink)] truncate">{prompt.name}</p>
                  </div>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--muted)] line-clamp-2 whitespace-pre-wrap break-words font-mono">
                    {prompt.content}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Tooltip content={t("admin.systemPrompts.active")} side="top">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={prompt.isActive}
                      aria-label={t("admin.systemPrompts.active")}
                      disabled={togglingId === prompt.id}
                      onClick={() => handleToggle(prompt)}
                      className={cn(
                        "relative w-8 h-[18px] rounded-full transition-colors cursor-pointer disabled:opacity-50",
                        prompt.isActive ? "bg-[var(--accent)]" : "bg-[var(--border)]"
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-xs transition-transform",
                          prompt.isActive && "translate-x-[14px]"
                        )}
                      />
                    </button>
                  </Tooltip>
                  <Tooltip content={t("admin.systemPrompts.edit")} side="top">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(prompt);
                        setIsModalOpen(true);
                      }}
                      className="grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                      aria-label={t("admin.systemPrompts.edit")}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
                  <Tooltip content={t("admin.systemPrompts.delete")} side="top" align="end">
                    <button
                      type="button"
                      onClick={() => setDeleting(prompt)}
                      className="grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-red-500/10 hover:text-red-500 transition-colors cursor-pointer"
                      aria-label={t("admin.systemPrompts.delete")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>
          ))}
          <DataTablePagination
            page={page}
            pageSize={pageSize}
            totalItems={prompts.length}
            onPageChange={setPage}
            onPageSizeChange={(newSize) => {
              setPageSize(newSize);
              setPage(1);
            }}
            className="rounded-[12px] border border-[var(--border)]"
          />
        </div>
      )}

      {/* Placeholder reference, so admins know what they can use */}
      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-3.5">
        <p className="text-sm font-medium text-[var(--ink)]">{t("admin.systemPrompts.placeholdersTitle")}</p>
        <p className="text-xs text-[var(--muted)] mb-2.5">{t("admin.systemPrompts.placeholdersHint")}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
          {PROMPT_PLACEHOLDERS.map((p) => (
            <div key={p.key} className="flex items-baseline gap-2 min-w-0 text-[12px]">
              <code className="shrink-0 font-mono text-[var(--accent)]">{`{${p.key}}`}</code>
              <span className="text-[var(--muted)] truncate">
                {t(`admin.systemPrompts.placeholders.${p.descriptionKey}`)} ·{" "}
                <span className="text-[var(--ink)]">{p.example}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      <SystemPromptModal
        isOpen={isModalOpen}
        prompt={editing}
        onClose={() => setIsModalOpen(false)}
        onSaved={() => {
          void load();
          toast(t("admin.systemPrompts.saved"));
        }}
      />

      <ConfirmModal
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={handleConfirmDelete}
        title={t("admin.systemPrompts.deleteTitle")}
        description={t("admin.systemPrompts.deleteDescription", { name: deleting?.name ?? "" })}
        confirmLabel={t("admin.systemPrompts.delete")}
        cancelLabel={t("admin.systemPrompts.cancel")}
        variant="danger"
        loading={isDeleting}
      />
    </div>
  );
}
