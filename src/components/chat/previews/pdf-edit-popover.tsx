"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, X } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import type { PdfRect } from "./pdf-edit-types";

export interface PdfEditPopoverProps {
  rect: PdfRect;
  pageWidth: number;
  debugMode?: boolean;
  onToggleDebugMode?: () => void;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

export function PdfEditPopover({
  rect,
  pageWidth,
  onSubmit,
  onCancel,
}: PdfEditPopoverProps) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      if (prompt.trim()) {
        onSubmit(prompt.trim());
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  // Position popover right below rect, clamped within page width
  const popoverWidth = 380;
  const left = Math.max(8, Math.min(pageWidth - popoverWidth - 8, rect.x));
  const top = rect.y + rect.height + 8;

  return (
    <div
      style={{
        position: "absolute",
        left: `${left}px`,
        top: `${top}px`,
        width: `${popoverWidth}px`,
        zIndex: 50,
      }}
      className="select-none animate-in fade-in zoom-in-95 duration-150"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#1c1c1f] text-white shadow-2xl border border-white/15 text-xs backdrop-blur-md">
        <input
          ref={inputRef}
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("chatFiles.requestEditsPlaceholder")}
          className="flex-1 min-w-0 bg-transparent text-xs text-white placeholder:text-neutral-400 outline-none px-1"
          autoFocus
          spellCheck={false}
        />

        {/* Submit Checkmark Button */}
        <button
          type="button"
          disabled={!prompt.trim()}
          onClick={() => {
            if (prompt.trim()) onSubmit(prompt.trim());
          }}
          className="grid place-items-center w-6 h-6 rounded-full bg-white/20 hover:bg-white/30 disabled:opacity-30 disabled:pointer-events-none text-white transition-colors cursor-pointer shrink-0"
          aria-label={t("chatFiles.requestEditsSubmit")}
        >
          <Check className="w-3.5 h-3.5" />
        </button>

        {/* Close Button */}
        <button
          type="button"
          onClick={onCancel}
          className="grid place-items-center w-6 h-6 rounded-full text-white/50 hover:text-white transition-colors cursor-pointer shrink-0"
          aria-label={t("chatFiles.cancel")}
        >
          <X className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}
