"use client";

import React, { useEffect, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { cn } from "@/lib/cn";
import { ConfirmModal } from "@/components/modals/confirm-modal";

interface MemorySettings {
  memoryEnabled: boolean;
  chatSearchEnabled: boolean;
  includeSensitive: boolean;
}

interface MemoryNote {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
}

const MAX_TITLE_CHARS = 200;
const MAX_CONTENT_CHARS = 50_000;

const secondaryButton =
  "px-3 py-1 text-xs font-medium rounded-lg bg-[var(--surface-hover)] hover:bg-[var(--surface-active)] text-[var(--ink)] border border-[var(--border)]/50 transition-colors cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed";

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed",
        checked ? "bg-[#2563eb]" : "bg-[var(--border)]"
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
          checked ? "translate-x-4" : "translate-x-0"
        )}
      />
    </button>
  );
}

function SettingRow({
  title,
  description,
  badge,
  children,
}: {
  title: string;
  description: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-3 flex items-center justify-between gap-4 border-b border-[var(--border)]/35">
      <div className="min-w-0 flex-1 pr-2">
        <p className="text-sm font-medium text-[var(--ink)] flex items-center gap-2">
          {title}
          {badge && (
            <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--surface-hover)] text-[var(--muted)]">
              {badge}
            </span>
          )}
        </p>
        <p className="text-xs text-[var(--muted)] mt-0.5 leading-relaxed">{description}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  );
}

/** Inline editor for a new or existing note */
function NoteEditor({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial?: { title: string; content: string };
  saving: boolean;
  onSave: (value: { title: string; content: string }) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const canSave = title.trim().length > 0 && content.trim().length > 0 && !saving;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel-elevated)] p-3 space-y-2">
      <input
        type="text"
        value={title}
        maxLength={MAX_TITLE_CHARS}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("settings.memoryTitleLabel")}
        aria-label={t("settings.memoryTitleLabel")}
        autoFocus
        className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--panel)] border border-[var(--border)]/60 text-[var(--ink)] placeholder-[var(--muted)] outline-none focus:border-[var(--accent)] transition-colors"
      />
      <textarea
        value={content}
        maxLength={MAX_CONTENT_CHARS}
        onChange={(e) => setContent(e.target.value)}
        placeholder={t("settings.memoryContentLabel")}
        aria-label={t("settings.memoryContentLabel")}
        rows={4}
        className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--panel)] border border-[var(--border)]/60 text-[var(--ink)] placeholder-[var(--muted)] outline-none focus:border-[var(--accent)] transition-colors resize-y"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={secondaryButton} disabled={saving}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={() => onSave({ title: title.trim(), content: content.trim() })}
          disabled={!canSave}
          className="px-3 py-1 text-xs font-semibold rounded-lg bg-[var(--accent)] text-[var(--accent-text)] hover:bg-[var(--accent-hover)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
        >
          {saving && <Loader2 className="w-3 h-3 animate-spin" />}
          {t("settings.memorySave")}
        </button>
      </div>
    </div>
  );
}

export function MemoryTab() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [settings, setSettings] = useState<MemorySettings | null>(null);
  const [notes, setNotes] = useState<MemoryNote[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [savingSetting, setSavingSetting] = useState<keyof MemorySettings | null>(null);

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showDeleteAll, setShowDeleteAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/me/memory", { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.data) throw new Error();
        return json.data as { settings: MemorySettings; notes: MemoryNote[] };
      })
      .then((data) => {
        if (cancelled) return;
        setSettings(data.settings);
        setNotes(data.notes);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const toggleSetting = async (key: keyof MemorySettings) => {
    if (!settings) return;
    const next = { ...settings, [key]: !settings[key] };
    setSettings(next);
    setSavingSetting(key);
    try {
      const res = await fetch("/api/v1/me/memory/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: next[key] }),
      });
      const json = await res.json();
      if (!res.ok || !json.data) throw new Error();
      setSettings(json.data.settings);
    } catch {
      setSettings(settings);
      toast(t("settings.memoryActionFailed"));
    } finally {
      setSavingSetting(null);
    }
  };

  const saveNote = async (value: { title: string; content: string }, noteId?: string) => {
    setSavingNote(true);
    try {
      const res = await fetch(noteId ? `/api/v1/me/memory/${noteId}` : "/api/v1/me/memory", {
        method: noteId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      const json = await res.json();
      if (!res.ok || !json.data) throw new Error();
      const saved = json.data.note as MemoryNote;
      setNotes((prev) => [saved, ...prev.filter((n) => n.id !== saved.id)]);
      setAdding(false);
      setEditingId(null);
      toast(t("settings.memorySaved"));
    } catch {
      toast(t("settings.memoryActionFailed"));
    } finally {
      setSavingNote(false);
    }
  };

  const deleteNote = async (noteId: string) => {
    setDeletingId(noteId);
    try {
      const res = await fetch(`/api/v1/me/memory/${noteId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      toast(t("settings.memoryDeleted"));
    } catch {
      toast(t("settings.memoryActionFailed"));
    } finally {
      setDeletingId(null);
    }
  };

  const deleteAll = async () => {
    setDeletingAll(true);
    try {
      const res = await fetch("/api/v1/me/memory", { method: "DELETE" });
      if (!res.ok) throw new Error();
      setNotes([]);
      setShowDeleteAll(false);
      toast(t("settings.memoryDeletedAll"));
    } catch {
      toast(t("settings.memoryActionFailed"));
    } finally {
      setDeletingAll(false);
    }
  };

  const exportMemory = async () => {
    if (notes.length === 0) {
      toast(t("settings.memoryExportEmpty"));
      return;
    }
    setExporting(true);
    try {
      const res = await fetch("/api/v1/me/memory/export");
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = match?.[1] ?? "devnuby-memory.zip";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast(t("settings.memoryExportDone"));
    } catch {
      toast(t("settings.memoryExportFailed"));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="w-full">
      <div>
        <h2 className="text-lg font-semibold text-[var(--ink)]">{t("settings.memoryTab")}</h2>
        <p className="text-xs text-[var(--muted)] mt-1 mb-5 leading-relaxed">{t("settings.memoryDesc")}</p>
      </div>

      {loading ? (
        <div className="py-12 grid place-items-center">
          <Loader2 className="w-5 h-5 animate-spin text-[var(--muted)]" />
        </div>
      ) : loadFailed || !settings ? (
        <div className="py-10 text-center space-y-3">
          <p className="text-sm text-[var(--muted)]">{t("settings.memoryFailed")}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setLoadFailed(false);
              setReloadKey((k) => k + 1);
            }}
            className={secondaryButton}
          >
            {t("common.retry")}
          </button>
        </div>
      ) : (
        <>
          <div>
            <SettingRow title={t("settings.memoryChatSearch")} description={t("settings.memoryChatSearchDesc")}>
              {savingSetting === "chatSearchEnabled" && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />
              )}
              <Toggle
                checked={settings.chatSearchEnabled}
                disabled={savingSetting !== null}
                onChange={() => void toggleSetting("chatSearchEnabled")}
                label={t("settings.memoryChatSearch")}
              />
            </SettingRow>

            <SettingRow title={t("settings.memoryEnabled")} description={t("settings.memoryEnabledDesc")}>
              {savingSetting === "memoryEnabled" && (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />
              )}
              <Toggle
                checked={settings.memoryEnabled}
                disabled={savingSetting !== null}
                onChange={() => void toggleSetting("memoryEnabled")}
                label={t("settings.memoryEnabled")}
              />
            </SettingRow>

            {settings.memoryEnabled && (
              <>
                <SettingRow
                  title={t("settings.memorySensitive")}
                  description={t("settings.memorySensitiveDesc")}
                  badge={t("settings.memorySensitiveSoon")}
                >
                  {savingSetting === "includeSensitive" && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />
                  )}
                  <Toggle
                    checked={settings.includeSensitive}
                    disabled={savingSetting !== null}
                    onChange={() => void toggleSetting("includeSensitive")}
                    label={t("settings.memorySensitive")}
                  />
                </SettingRow>

                <SettingRow
                  title={t("settings.memoryImport")}
                  description={t("settings.memoryImportDesc")}
                  badge={t("settings.memoryImportSoon")}
                >
                  <button type="button" disabled className={secondaryButton}>
                    {t("settings.memoryImport")}
                  </button>
                </SettingRow>

                <SettingRow title={t("settings.memoryExport")} description={t("settings.memoryExportDesc")}>
                  <button
                    type="button"
                    onClick={() => void exportMemory()}
                    disabled={exporting}
                    className={cn(secondaryButton, "inline-flex items-center gap-1.5")}
                  >
                    {exporting && <Loader2 className="w-3 h-3 animate-spin" />}
                    {t("settings.memoryExportBtn")}
                  </button>
                </SettingRow>
              </>
            )}
          </div>

          {/* Saved notes stay visible even with memory off, so they can still be reviewed or deleted */}
          <div className="mt-8">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="text-sm font-semibold text-[var(--ink)]">
                {t("settings.memoryListTitle")}
                {notes.length > 0 && (
                  <span className="ml-1.5 text-xs font-normal text-[var(--muted)]">({notes.length})</span>
                )}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setAdding(true);
                  setEditingId(null);
                }}
                disabled={adding}
                className={cn(secondaryButton, "inline-flex items-center gap-1")}
              >
                <Plus className="w-3.5 h-3.5" />
                {t("settings.memoryAdd")}
              </button>
            </div>

            {adding && (
              <div className="mb-3">
                <NoteEditor saving={savingNote} onSave={(v) => void saveNote(v)} onCancel={() => setAdding(false)} />
              </div>
            )}

            {notes.length === 0 && !adding ? (
              <div className="rounded-xl border border-dashed border-[var(--border)] py-10 px-6 text-center">
                <p className="text-sm text-[var(--muted)]">{t("settings.memoryEmpty")}</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {notes.map((note) =>
                  editingId === note.id ? (
                    <li key={note.id}>
                      <NoteEditor
                        initial={note}
                        saving={savingNote}
                        onSave={(v) => void saveNote(v, note.id)}
                        onCancel={() => setEditingId(null)}
                      />
                    </li>
                  ) : (
                    <li
                      key={note.id}
                      className="group rounded-xl border border-[var(--border)]/60 bg-[var(--panel-elevated)] px-4 py-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-[var(--ink)] break-words">{note.title}</p>
                          <p className="text-xs text-[var(--muted)] mt-1 leading-relaxed whitespace-pre-wrap break-words line-clamp-6">
                            {note.content}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(note.id);
                              setAdding(false);
                            }}
                            aria-label={t("settings.memoryEdit")}
                            title={t("settings.memoryEdit")}
                            className="w-7 h-7 rounded-md grid place-items-center text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteNote(note.id)}
                            disabled={deletingId === note.id}
                            aria-label={t("settings.memoryDelete")}
                            title={t("settings.memoryDelete")}
                            className="w-7 h-7 rounded-md grid place-items-center text-[var(--muted)] hover:bg-red-500/10 hover:text-red-400 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {deletingId === note.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                )}
              </ul>
            )}

            {notes.length > 0 && (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowDeleteAll(true)}
                  className="px-3 py-1 text-xs font-medium rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 transition-colors cursor-pointer"
                >
                  {t("settings.memoryDeleteAll")}
                </button>
              </div>
            )}
          </div>
        </>
      )}

      <ConfirmModal
        isOpen={showDeleteAll}
        onClose={() => setShowDeleteAll(false)}
        onConfirm={deleteAll}
        title={t("settings.memoryDeleteAll")}
        description={t("settings.memoryDeleteAllConfirm")}
        confirmLabel={t("settings.memoryDelete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        loading={deletingAll}
      />
    </div>
  );
}
