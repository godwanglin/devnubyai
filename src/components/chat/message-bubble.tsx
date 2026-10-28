"use client";

import React, { useState } from "react";
import { Check, Copy, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { useI18n } from "@/providers/i18n-provider";
import type { Message } from "@/types";

interface MessageBubbleProps {
  message: Message;
  isStreaming?: boolean;
  onRegenerate?: () => void;
}

export function MessageBubble({ message, isStreaming, onRegenerate }: MessageBubbleProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const isUser = message.role === "user";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  }

  if (isUser) {
    return (
      <div className="flex justify-end pl-6 sm:pl-14 py-4">
        <div
          className={cn(
            "max-w-[80%] px-4 py-3 rounded-[16px] rounded-br-[6px]",
            "bg-[var(--bubble-user)] text-[var(--bubble-user-text)]",
            "text-[15px] leading-relaxed whitespace-pre-wrap break-words"
          )}
        >
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="py-4">
      <div className={cn("prose-chat", isStreaming && "typewriter-fade-in")}>
        <MarkdownRenderer content={message.content} />
      </div>
      <div className="flex items-center gap-0.5 mt-2.5">
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-[6px] text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? t("message.copied") : t("message.copy")}</span>
        </button>
        {onRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            className="inline-flex items-center gap-1.5 px-2 py-1.5 rounded-[6px] text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>{t("message.regenerate")}</span>
          </button>
        )}
      </div>
    </div>
  );
}
