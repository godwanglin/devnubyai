"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";

export interface TextEditPopoverProps {
  top: number;
  left: number;
  badgeLabel?: string;
  debugMode: boolean;
  onToggleDebugMode: () => void;
  onSubmit: (prompt: string) => void;
  onCancel: () => void;
  positionMode?: "absolute" | "fixed";
}

export function TextEditPopover({
  top,
  left,
  badgeLabel,
  debugMode,
  onToggleDebugMode,
  onSubmit,
  onCancel,
  positionMode = "absolute",
}: TextEditPopoverProps) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!debugMode || prompt.trim()) {
        onSubmit(prompt.trim());
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div
      style={{
        position: positionMode,
        left: `${left}px`,
        top: `${top}px`,
        zIndex: 90,
      }}
      className="select-none animate-in fade-in zoom-in-95 duration-150 pointer-events-auto"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass text-[var(--ink)] shadow-2xl text-xs max-w-[420px] w-max">
        {badgeLabel ? (
          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-[var(--hover)] text-[var(--muted)] border border-[var(--border)] font-medium shrink-0">
            {badgeLabel}
          </span>
        ) : null}

        <input
          ref={inputRef}
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("chatFiles.requestEditsPlaceholder")}
          className="w-48 sm:w-60 bg-transparent text-xs text-[var(--ink)] placeholder:text-[var(--placeholder)] outline-none px-1"
          autoFocus
          spellCheck={false}
        />

        {/* DebugMode / AI Mode Toggle Pill */}
        <button
          type="button"
          onClick={onToggleDebugMode}
          title={
            debugMode
              ? "debugMode: true (Instant live edit). Click to switch to AI prompt mode."
              : "debugMode: false (Send request to AI). Click to switch to instant edit."
          }
          className={`px-2 py-0.5 rounded-full text-[10px] font-mono tracking-tight border transition-colors cursor-pointer shrink-0 ${
            debugMode
              ? "border-[var(--border)] bg-[var(--hover)] text-[var(--ink)] font-semibold"
              : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-[var(--ink)]"
          }`}
        >
          {debugMode ? t("chatFiles.requestEditsInstant") : t("chatFiles.requestEditsAi")}
        </button>

        {/* Submit Checkmark Button */}
        <button
          type="button"
          disabled={debugMode && !prompt.trim()}
          onClick={() => {
            if (!debugMode || prompt.trim()) onSubmit(prompt.trim());
          }}
          className="grid place-items-center w-6 h-6 rounded-full bg-[var(--ink)] text-[var(--surface)] hover:opacity-90 disabled:opacity-30 disabled:pointer-events-none transition-opacity cursor-pointer shrink-0 shadow-xs"
          aria-label={t("chatFiles.requestEditsConfirm") || t("chatFiles.requestEditsSubmit")}
          title={t("chatFiles.requestEditsConfirm") || t("chatFiles.requestEditsSubmit")}
        >
          <Check className="w-3.5 h-3.5" />
        </button>

        {/* Cancel Button */}
        <button
          type="button"
          onClick={onCancel}
          className="grid place-items-center w-6 h-6 rounded-full hover:bg-[var(--hover)] text-[var(--muted)] hover:text-[var(--ink)] transition-colors cursor-pointer shrink-0"
          aria-label={t("chatFiles.close")}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
