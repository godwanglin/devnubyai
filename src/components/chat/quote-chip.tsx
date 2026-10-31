"use client";

import React from "react";
import { MessageSquareQuote } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";

interface QuoteChipProps {
  quotes: string[];
}

/**
 * "N pilihan" chip on a user message; hovering (or focusing) it reveals the
 * excerpts the user selected from the conversation when asking.
 */
export function QuoteChip({ quotes }: QuoteChipProps) {
  const { t } = useI18n();

  return (
    <div className="relative group/quote mb-1.5">
      <button
        type="button"
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--panel)] text-xs font-semibold text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)] transition-colors cursor-default"
        aria-label={t("selection.quoteCount", { count: String(quotes.length) })}
      >
        <MessageSquareQuote className="w-3.5 h-3.5" />
        {t("selection.quoteCount", { count: String(quotes.length) })}
      </button>

      <div
        role="tooltip"
        className="absolute right-0 bottom-full mb-2 z-30 w-[min(360px,80vw)] max-h-[280px] overflow-y-auto p-3 space-y-2 rounded-[12px] glass invisible opacity-0 translate-y-1 transition-[opacity,transform,visibility] duration-150 group-hover/quote:visible group-hover/quote:opacity-100 group-hover/quote:translate-y-0 group-focus-within/quote:visible group-focus-within/quote:opacity-100 group-focus-within/quote:translate-y-0"
      >
        {quotes.map((quote, index) => (
          <p
            key={index}
            className="pl-2.5 border-l-2 border-[var(--primary)] text-[13px] leading-relaxed text-[var(--ink)] whitespace-pre-wrap break-words"
          >
            &ldquo;{quote}&rdquo;
          </p>
        ))}
      </div>
    </div>
  );
}
