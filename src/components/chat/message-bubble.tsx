"use client";

import React, { useMemo, useSyncExternalStore, useState } from "react";
import {
  Check,
  Copy,
  Volume2,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { Tooltip } from "@/components/ui/tooltip";
import { ThinkingAccordion } from "./thinking-accordion";
import { ToolActivityList } from "./tool-activity";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import type { CompactWebSource } from "@/lib/tools/compact-source";
import type { Message } from "@/types";

interface MessageBubbleProps {
  message: Message;
  chatId?: string;
  isStreaming?: boolean;
  onRegenerate?: () => void;
}

const emptySubscribe = () => () => {};

/**
 * Formats a message timestamp into user's requested format:
 * - "sekarang" (< 1 minute)
 * - "x menit lalu" (< 1 hour)
 * - "x jam lalu" (< 24 hours)
 * - "x hari lalu" (<= 7 days)
 * - "12 Oktober 2026" / "12 October 2026" (> 7 days)
 */
function formatMessageTime(dateString: string, locale: "id" | "en"): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const diffSec = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 1000));
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  const isId = locale === "id";

  if (diffSec < 60) {
    return isId ? "sekarang" : "just now";
  }
  if (diffMin < 60) {
    return isId ? `${diffMin} menit lalu` : `${diffMin}m ago`;
  }
  if (diffHour < 24) {
    return isId ? `${diffHour} jam lalu` : `${diffHour}h ago`;
  }
  if (diffDay <= 7) {
    return isId ? `${diffDay} hari lalu` : `${diffDay}d ago`;
  }

  // > 7 days -> e.g. "12 Oktober 2026"
  const day = date.getDate();
  const year = date.getFullYear();
  const monthFormatter = new Intl.DateTimeFormat(isId ? "id-ID" : "en-US", {
    month: "long",
  });
  const monthName = monthFormatter.format(date);

  return `${day} ${monthName} ${year}`;
}

export function MessageBubble({ message, chatId, isStreaming, onRegenerate }: MessageBubbleProps) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"like" | "dislike" | null>(null);

  // Client-mounted check without causing hydration layout jumps
  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const isUser = message.role === "user";
  const formattedTime = isMounted ? formatMessageTime(message.createdAt, locale) : "";

  // Build a lookup map of URLs -> source metadata from search tool outputs
  const sourcesMap = useMemo(() => {
    const map = new Map<string, CompactWebSource>();
    if (!message.toolCalls) return map;

    for (const tool of message.toolCalls) {
      const out = tool.output as { sources?: CompactWebSource[]; results?: Array<{ title?: string; url?: string }> } | undefined;
      if (Array.isArray(out?.sources)) {
        for (const s of out.sources) {
          if (s?.url) map.set(s.url, s);
        }
      } else if (Array.isArray(out?.results)) {
        for (const r of out.results) {
          if (r?.url) {
            map.set(r.url, {
              title: r.title || "Web Result",
              url: r.url,
              domain: "",
            });
          }
        }
      }
    }
    return map;
  }, [message.toolCalls]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  }

  function handleFeedback(type: "like" | "dislike") {
    if (feedback === type) {
      setFeedback(null);
    } else {
      setFeedback(type);
      toast(t("message.feedbackRecorded"));
    }
  }

  if (isUser) {
    return (
      <div className="group flex flex-col items-end pl-6 sm:pl-14 py-4">
        <div
          className={cn(
            "max-w-[80%] px-4 py-3 rounded-[16px] rounded-br-[6px]",
            "bg-[var(--bubble-user)] text-[var(--bubble-user-text)]",
            "text-[15px] leading-relaxed whitespace-pre-wrap break-words"
          )}
        >
          {message.content}
        </div>
        {formattedTime ? (
          <span className="text-[11px] text-[var(--muted)] mt-1 px-1 select-none opacity-0 group-hover:opacity-100 transition-opacity">
            {formattedTime}
          </span>
        ) : null}
      </div>
    );
  }

  const hasContent = Boolean(message.content.trim());
  const hasActivity = Boolean(message.reasoning) || Boolean(message.toolCalls?.length);
  const isToolRunning = message.toolCalls?.some(
    (tool) => tool.state === "running" || tool.state === "streaming"
  );

  // Balasan yang dibatalkan sebelum ada teks/aktivitas: biarkan kosong tanpa action bar
  if (!isStreaming && !hasContent && !hasActivity) return null;

  return (
    <div className="py-4 group">
      {message.reasoning ? (
        <ThinkingAccordion
          content={message.reasoning}
          isStreaming={isStreaming && message.isReasoningStreaming && !hasContent}
        />
      ) : null}

      {message.toolCalls?.length ? (
        <ToolActivityList
          tools={message.toolCalls}
          messageId={message.id}
          chatId={chatId}
        />
      ) : null}

      {hasContent ? (
        <div className={cn("prose-chat", isStreaming && "typewriter-fade-in")}>
          <MarkdownRenderer content={message.content} sourcesMap={sourcesMap} />
        </div>
      ) : null}

      {!hasContent && !isStreaming ? null : isStreaming ? (
        message.isReasoningStreaming || isToolRunning ? null : (
        <div
          className="flex items-center gap-1.5 mt-2.5 py-1"
          role="status"
          aria-live="polite"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--placeholder)] animate-pulse" />
          <span
            className="w-1.5 h-1.5 rounded-full bg-[var(--placeholder)] animate-pulse"
            style={{ animationDelay: "150ms" }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full bg-[var(--placeholder)] animate-pulse"
            style={{ animationDelay: "300ms" }}
          />
        </div>
        )
      ) : (
        <div className="flex items-center gap-2 mt-2.5">
          {/* Action buttons (icon-only with tooltips) */}
          <div className="flex items-center gap-0.5">
            {/* Copy button */}
            <Tooltip content={copied ? t("message.copied") : t("message.copy")} side="top">
              <button
                type="button"
                onClick={handleCopy}
                className={cn(
                  "grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer",
                  copied && "text-[var(--accent)]"
                )}
                aria-label={copied ? t("message.copied") : t("message.copy")}
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </Tooltip>

            {/* Read aloud / voice button */}
            <Tooltip content={t("message.readAloud")} side="top">
              <button
                type="button"
                onClick={() => toast(t("toast.featureUnavailable"))}
                className="grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                aria-label={t("message.readAloud")}
              >
                <Volume2 className="w-3.5 h-3.5" />
              </button>
            </Tooltip>

            {/* Regenerate button */}
            {onRegenerate ? (
              <Tooltip content={t("message.regenerate")} side="top">
                <button
                  type="button"
                  onClick={onRegenerate}
                  className="grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                  aria-label={t("message.regenerate")}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
              </Tooltip>
            ) : null}

            <span className="w-px h-3.5 bg-[var(--border)] mx-1" aria-hidden="true" />

            {/* Feedback: Like button */}
            <Tooltip content={t("message.like")} side="top">
              <button
                type="button"
                onClick={() => handleFeedback("like")}
                className={cn(
                  "grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer",
                  feedback === "like" && "text-[var(--accent)] bg-[var(--accent-soft)]"
                )}
                aria-label={t("message.like")}
              >
                <ThumbsUp className="w-3.5 h-3.5" />
              </button>
            </Tooltip>

            {/* Feedback: Dislike button */}
            <Tooltip content={t("message.dislike")} side="top">
              <button
                type="button"
                onClick={() => handleFeedback("dislike")}
                className={cn(
                  "grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer",
                  feedback === "dislike" && "text-red-500 bg-red-500/10"
                )}
                aria-label={t("message.dislike")}
              >
                <ThumbsDown className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          </div>

          {/* Timestamp right beside icons - only visible on bubble hover */}
          {formattedTime ? (
            <span className="text-[11px] text-[var(--muted)] select-none px-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {formattedTime}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
