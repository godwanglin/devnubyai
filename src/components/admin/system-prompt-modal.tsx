"use client";

import React, { useMemo, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/providers/i18n-provider";
import {
  PROMPT_PLACEHOLDERS,
  renderPromptTemplate,
  type SystemPromptDto,
} from "@/lib/chat/system-prompts-shared";

interface SystemPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** null to create a new prompt */
  prompt: SystemPromptDto | null;
  onSaved: () => void;
}

const exampleValues = Object.fromEntries(PROMPT_PLACEHOLDERS.map((p) => [p.key, p.example]));

const inputClass =
  "w-full px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] text-sm outline-none focus:border-[var(--accent)]";

function SystemPromptForm({
  prompt,
  onClose,
  onSaved,
}: Omit<SystemPromptModalProps, "isOpen">) {
  const { t } = useI18n();
  const isEdit = Boolean(prompt);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  const [name, setName] = useState(() => prompt?.name ?? "");
  const [content, setContent] = useState(() => prompt?.content ?? "");
  const [sortOrder, setSortOrder] = useState(() => String(prompt?.sortOrder ?? 100));
  const [isActive, setIsActive] = useState(() => prompt?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const preview = useMemo(() => renderPromptTemplate(content, exampleValues), [content]);

  /** Inserts `{key}` at the caret so admins don't have to type placeholders by hand. */
  function insertPlaceholder(key: string) {
    const token = `{${key}}`;
    const el = contentRef.current;
    if (!el) {
      setContent((prev) => prev + token);
      return;
    }
    const start = el.selectionStart ?? content.length;
    const end = el.selectionEnd ?? content.length;
    const next = content.slice(0, start) + token + content.slice(end);
    setContent(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(
        isEdit ? `/api/v1/admin/system-prompts/${prompt!.id}` : "/api/v1/admin/system-prompts",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            name: name.trim(),
            content: content.trim(),
            sortOrder: Number(sortOrder) || 0,
            isActive,
          }),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || t("admin.systemPrompts.saveFailed"));
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("admin.systemPrompts.saveFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="p-3 rounded-[8px] bg-red-500/10 border border-red-500/20 text-xs text-red-500">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">
            {t("admin.systemPrompts.name")}
          </label>
          <input
            type="text"
            required
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("admin.systemPrompts.namePlaceholder")}
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-[var(--muted)] mb-1">
            {t("admin.systemPrompts.order")}
          </label>
          <input
            type="number"
            min={0}
            max={65535}
            required
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-[var(--muted)] mb-1">
          {t("admin.systemPrompts.content")}
        </label>
        <textarea
          ref={contentRef}
          required
          rows={7}
          maxLength={20000}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="You are DevNuby... Your model is {model.id} powered by {model.provider}."
          className={`${inputClass} resize-y font-mono text-[13px] leading-relaxed`}
        />
      </div>

      <div>
        <p className="text-xs font-medium text-[var(--muted)] mb-1.5">
          {t("admin.systemPrompts.placeholdersTitle")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PROMPT_PLACEHOLDERS.map((p) => (
            <Tooltip
              key={p.key}
              content={`${t(`admin.systemPrompts.placeholders.${p.descriptionKey}`)} · ${p.example}`}
              side="top"
            >
              <button
                type="button"
                onClick={() => insertPlaceholder(p.key)}
                className="px-2 py-1 rounded-[6px] border border-[var(--border)] bg-[var(--surface)] font-mono text-[11.5px] text-[var(--ink)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors cursor-pointer"
              >
                {`{${p.key}}`}
              </button>
            </Tooltip>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-[var(--muted)]">{t("admin.systemPrompts.placeholdersHint")}</p>
      </div>

      {content.trim() ? (
        <div>
          <p className="text-xs font-medium text-[var(--muted)] mb-1">
            {t("admin.systemPrompts.preview")}
          </p>
          <div className="max-h-40 overflow-y-auto rounded-[8px] border border-dashed border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--ink)] whitespace-pre-wrap break-words">
            {preview}
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 pt-1">
        <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-[var(--ink)]">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="rounded-[4px] accent-[var(--accent)]"
          />
          <span>{t("admin.systemPrompts.active")}</span>
        </label>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={loading}>
            {t("admin.systemPrompts.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={loading || !name.trim() || !content.trim()}>
            {loading ? t("admin.systemPrompts.saving") : t("admin.systemPrompts.save")}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function SystemPromptModal({ isOpen, onClose, prompt, onSaved }: SystemPromptModalProps) {
  const { t } = useI18n();
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={prompt ? t("admin.systemPrompts.editTitle") : t("admin.systemPrompts.createTitle")}
      maxWidth="xl"
    >
      {isOpen ? (
        <SystemPromptForm key={prompt?.id ?? "new"} prompt={prompt} onClose={onClose} onSaved={onSaved} />
      ) : null}
    </Modal>
  );
}
