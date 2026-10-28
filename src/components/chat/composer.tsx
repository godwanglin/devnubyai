"use client";

import React, { useRef, useState, useEffect } from "react";
import { ArrowUp, Mic, Plus, Paperclip, Globe, Brain, ImageIcon } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { Popover } from "@/components/ui/popover";
import { ModelSelector } from "./model-selector";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { cn } from "@/lib/cn";
import type { ReasoningLevel } from "@/types";

interface ComposerProps {
  onSend: (text: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  currentModelId: string;
  onModelChange: (modelId: string) => void;
  reasoningLevel: ReasoningLevel;
  onReasoningChange: (level: ReasoningLevel) => void;
}

export function Composer({
  onSend,
  onStop,
  disabled,
  currentModelId,
  onModelChange,
  reasoningLevel,
  onReasoningChange,
}: ComposerProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [webActive, setWebActive] = useState(false);
  const [thinkingActive, setThinkingActive] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [value]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  }

  return (
    <div className="relative z-10 px-4 sm:px-5 pb-5 bg-gradient-to-t from-[var(--surface)] via-[var(--surface)]/80 to-transparent pointer-events-none">
      <form
        onSubmit={handleSubmit}
        className={cn(
          "max-w-[768px] mx-auto rounded-[16px] border border-[var(--border)] bg-[var(--panel)]",
          "shadow-lg transition-colors pointer-events-auto",
          "focus-within:border-[var(--accent)]"
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={t("composer.inputPlaceholder")}
          className="w-full max-h-[240px] px-4 pt-3.5 pb-2 bg-transparent resize-none outline-none text-[15px] leading-relaxed text-[var(--ink)] placeholder:text-[var(--placeholder)]"
        />

        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
          {/* Tombol Plus di Kiri */}
          <div className="flex items-center gap-1">
            <Popover
              side="top"
              align="start"
              className="w-[180px]"
              trigger={
                <button
                  type="button"
                  className="grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                  aria-label={t("composer.attach")}
                >
                  <Plus className="w-4 h-4" />
                </button>
              }
            >
              <div className="space-y-0.5">
                <button
                  type="button"
                  onClick={() => toast(t("toast.featureUnavailable"))}
                  className="glass-hover flex items-center gap-2 w-full px-2.5 py-1.5 rounded-[6px] text-xs font-medium text-[var(--ink)] cursor-pointer"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-[var(--muted)]" />
                  <span>{t("composer.photo")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => toast(t("toast.featureUnavailable"))}
                  className="glass-hover flex items-center gap-2 w-full px-2.5 py-1.5 rounded-[6px] text-xs font-medium text-[var(--ink)] cursor-pointer"
                >
                  <Paperclip className="w-3.5 h-3.5 text-[var(--muted)]" />
                  <span>{t("composer.attachFile")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = !webActive;
                    setWebActive(next);
                    toast(
                      t(next ? "toast.toolActive" : "toast.toolInactive", {
                        tool: t("composer.webSearch"),
                      })
                    );
                  }}
                  className={cn(
                    "glass-hover flex items-center gap-2 w-full px-2.5 py-1.5 rounded-[6px] text-xs font-medium text-[var(--ink)] cursor-pointer",
                    webActive && "bg-[var(--accent-soft)] text-[var(--accent)]"
                  )}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>{t("composer.webSearch")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = !thinkingActive;
                    setThinkingActive(next);
                    toast(
                      t(next ? "toast.toolActive" : "toast.toolInactive", {
                        tool: t("composer.extendedThinking"),
                      })
                    );
                  }}
                  className={cn(
                    "glass-hover flex items-center gap-2 w-full px-2.5 py-1.5 rounded-[6px] text-xs font-medium text-[var(--ink)] cursor-pointer",
                    thinkingActive && "bg-[var(--accent-soft)] text-[var(--accent)]"
                  )}
                >
                  <Brain className="w-3.5 h-3.5" />
                  <span>{t("composer.extendedThinking")}</span>
                </button>
              </div>
            </Popover>
          </div>

          {/* Sisi Kanan: Model -> Mic -> Send */}
          <div className="flex items-center gap-1 ml-auto">
            <ModelSelector
              currentModelId={currentModelId}
              onModelChange={(id) => {
                onModelChange(id);
                toast(t("toast.modelChanged", { model: id }));
              }}
              reasoningLevel={reasoningLevel}
              onReasoningChange={(lvl) => {
                onReasoningChange(lvl);
                toast(t("toast.reasoningChanged", { level: lvl }));
              }}
            />

            <button
              type="button"
              onClick={() => toast(t("toast.featureUnavailable"))}
              className="grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
              aria-label={t("composer.voice")}
            >
              <Mic className="w-4 h-4" />
            </button>

            {disabled && onStop ? (
              <Tooltip content="Stop generation" side="top" align="end">
                <button
                  type="button"
                  onClick={onStop}
                  className="grid place-items-center w-8 h-8 rounded-[10px] text-[var(--accent-text)] bg-[var(--accent)] hover:bg-[var(--accent-hover)] active:scale-95 transition-all cursor-pointer"
                  aria-label="Stop generation"
                >
                  <span className="w-3 h-3 rounded-[2px] bg-current" />
                </button>
              </Tooltip>
            ) : (
              <Tooltip content={t("composer.enterToSend")} side="top" align="end">
                <button
                  type="submit"
                  disabled={!value.trim() || disabled}
                  className={cn(
                    "grid place-items-center w-8 h-8 rounded-[10px] text-[var(--accent-text)] bg-[var(--accent)]",
                    "hover:bg-[var(--accent-hover)] active:scale-95 transition-all cursor-pointer",
                    "disabled:bg-[var(--border)] disabled:text-[var(--placeholder)] disabled:cursor-not-allowed disabled:active:scale-100"
                  )}
                  aria-label={t("composer.send")}
                >
                  <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      </form>

      <p className="text-center text-[11.5px] text-[var(--placeholder)] mt-2">
        {t("composer.disclaimer")}
      </p>
    </div>
  );
}
