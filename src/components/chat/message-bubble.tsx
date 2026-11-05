"use client";

import React, { useMemo, useSyncExternalStore, useState, useRef, useEffect, memo } from "react";
import { Check, Copy, Volume2, RefreshCw, ThumbsUp, ThumbsDown, Pencil } from "lucide-react";
import { cn } from "@/lib/cn";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { Tooltip } from "@/components/ui/tooltip";
import { FeedbackModal } from "@/components/modals/feedback-modal";
import { AgentWorkAccordion } from "./agent-work-accordion";
import { MessageAttachments } from "./message-attachments";
import { ThinkingAccordion } from "./thinking-accordion";
import { ToolActivityList } from "./tool-activity";
import { TurnGeneratedFiles } from "./turn-generated-files";
import { MessageErrorCard } from "./message-error-card";
import { TypingIndicator } from "./typing-indicator";
import { QuoteChip } from "./quote-chip";
import { SourceMentionChips } from "./source-mention-chips";
import { EditTargetChip, parseRequestEditMessage } from "./edit-target-chip";
import { messageFeedbackMap } from "@/lib/chat/client-mappers";
import { useRequestRetry } from "@/lib/chat/request-retry-store";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import type { CompactWebSource } from "@/lib/tools/compact-source";
import type { Message } from "@/types";

interface MessageBubbleProps {
  message: Message;
  chatId?: string;
  isStreaming?: boolean;
  onRegenerate?: () => void;
  onEditSubmit?: (messageId: string, content: string) => Promise<void>;
}

const emptySubscribe = () => () => {};

/**
 * Formats message timestamp into relative/absolute string.
 */
function formatMessageTime(dateString: string, locale: "id" | "en"): string {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "";
  const sec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  const min = Math.floor(sec / 60), hr = Math.floor(min / 60), day = Math.floor(hr / 24);
  const isId = locale === "id";
  if (sec < 60) return isId ? "sekarang" : "just now";
  if (min < 60) return isId ? `${min} menit lalu` : `${min}m ago`;
  if (hr < 24) return isId ? `${hr} jam lalu` : `${hr}h ago`;
  if (day <= 7) return isId ? `${day} hari lalu` : `${day}d ago`;
  return `${date.getDate()} ${new Intl.DateTimeFormat(isId ? "id-ID" : "en-US", { month: "long" }).format(date)} ${date.getFullYear()}`;
}

export const MessageBubble = memo(function MessageBubble({
  message,
  chatId,
  isStreaming,
  onRegenerate,
  onEditSubmit,
}: MessageBubbleProps) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [localFeedback, setLocalFeedback] = useState<"like" | "dislike" | null | undefined>(undefined);
  const [isFeedbackModalOpen, setIsFeedbackModalOpen] = useState(false);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [isSubmittingEdit, setIsSubmittingEdit] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  // 1-second celebration state when generation completes ("done" event)
  const [donePhase, setDonePhase] = useState<"idle" | "showing" | "exiting">("idle");
  const prevStreamingRef = useRef(isStreaming);
  const doneTimersRef = useRef<{ show?: NodeJS.Timeout; exit?: NodeJS.Timeout }>({});

  const hasContent = Boolean(message.content.trim());
  const hasActivity = Boolean(message.reasoning) || Boolean(message.toolCalls?.length);
  // Retry of the running request ("attempt 2/5"); only the streaming reply shows it
  const requestRetry = useRequestRetry(isStreaming && message.role === "assistant" ? chatId : undefined);

  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;
    const timers = doneTimersRef.current;

    if (isStreaming) {
      if (timers.show) clearTimeout(timers.show);
      if (timers.exit) clearTimeout(timers.exit);
      setDonePhase("idle");
      return;
    }

    if (wasStreaming && !isStreaming && (hasContent || hasActivity)) {
      setDonePhase("showing");
      timers.show = setTimeout(() => {
        setDonePhase("exiting");
        timers.exit = setTimeout(() => setDonePhase("idle"), 380);
      }, 1000);
    }

    return () => {
      if (timers.show) clearTimeout(timers.show);
      if (timers.exit) clearTimeout(timers.exit);
    };
  }, [isStreaming, hasContent, hasActivity]);

  useEffect(() => { if (!isEditing) setEditContent(message.content); }, [message.content, isEditing]);

  useEffect(() => {
    if (isEditing) {
      editRef.current?.focus();
      editRef.current?.setSelectionRange(editContent.length, editContent.length);
    }
  }, [isEditing, editContent.length]);

  async function handleEditSubmit() {
    const content = editContent.trim();
    if (!content || !onEditSubmit || isSubmittingEdit) return;
    setIsSubmittingEdit(true);
    try {
      await onEditSubmit(message.id, content);
      setIsEditing(false);
    } catch {
      toast(t("toast.actionFailed"));
    } finally {
      setIsSubmittingEdit(false);
    }
  }

  const [prevMessageId, setPrevMessageId] = useState(message.id);
  if (prevMessageId !== message.id) {
    setPrevMessageId(message.id);
    setLocalFeedback(undefined);
  }
  if (isStreaming && localFeedback !== undefined) setLocalFeedback(undefined);

  const effectiveFeedback = localFeedback !== undefined ? localFeedback : (message.feedback ?? null);

  // Client-mounted check without causing hydration layout jumps
  const isMounted = useSyncExternalStore(emptySubscribe, () => true, () => false);

  const isUser = message.role === "user";
  const parsedEdit = useMemo(
    () => (isUser ? parseRequestEditMessage(message.content) : null),
    [isUser, message.content]
  );
  const userDisplayText = parsedEdit?.isEditRequest ? parsedEdit.userText : message.content;
  const formattedTime = isMounted ? formatMessageTime(message.createdAt, locale) : "";

  // Build a lookup map of URLs -> source metadata from search tool outputs
  const sourcesMap = useMemo(() => {
    const map = new Map<string, CompactWebSource>();
    if (!message.toolCalls) return map;
    for (const tool of message.toolCalls) {
      const out = tool.output as { sources?: CompactWebSource[]; results?: Array<{ title?: string; url?: string }> } | undefined;
      if (Array.isArray(out?.sources)) {
        for (const s of out.sources) if (s?.url) map.set(s.url, s);
      } else if (Array.isArray(out?.results)) {
        for (const r of out.results) if (r?.url) map.set(r.url, { title: r.title || "Web Result", url: r.url, domain: "" });
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

  async function persistFeedback(
    nextRating: "like" | "dislike" | null,
    details?: { reason?: string; comment?: string }
  ): Promise<boolean> {
    if (!chatId) return false;
    try {
      const res = await fetch(`/api/v1/chats/${chatId}/messages/${message.id}/feedback`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rating: nextRating,
          ...(details?.reason ? { reason: details.reason } : {}),
          ...(details?.comment ? { comment: details.comment } : {}),
        }),
        credentials: "same-origin",
      });
      if (!res.ok) return false;
      if (nextRating) messageFeedbackMap.set(message.id, nextRating);
      else messageFeedbackMap.delete(message.id);
      return true;
    } catch {
      return false;
    }
  }

  async function handleFeedback(type: "like" | "dislike") {
    if (!chatId) return;
    const prevRating = effectiveFeedback;
    const nextRating = prevRating === type ? null : type;
    setLocalFeedback(nextRating);
    if (nextRating === "dislike") setIsFeedbackModalOpen(true);
    const ok = await persistFeedback(nextRating);
    if (!ok) {
      setLocalFeedback(prevRating);
      setIsFeedbackModalOpen(false);
      toast(t("toast.actionFailed"));
      return;
    }
    if (nextRating === "like") toast(t("message.feedbackRecorded"));
    else if (nextRating === null) toast(t("message.feedbackRemoved"));
  }

  async function handleSubmitDislikeDetails(details: { reason?: string; comment?: string }) {
    if (!chatId) return;
    setIsSubmittingFeedback(true);
    const ok = await persistFeedback("dislike", details);
    setIsSubmittingFeedback(false);
    setIsFeedbackModalOpen(false);
    toast(ok ? t("message.feedbackRecorded") : t("toast.actionFailed"));
  }

  if (isUser) {
    return (
      <div id={`message-${message.id}`} className="group flex flex-col items-end pl-6 sm:pl-14 py-4">
        {message.attachments?.length ? <MessageAttachments attachments={message.attachments} chatId={chatId} /> : null}
        {message.quotes?.length ? <QuoteChip quotes={message.quotes} /> : null}
        {message.sourceMentions?.length ? <SourceMentionChips mentions={message.sourceMentions} /> : null}
        {parsedEdit?.isEditRequest ? <EditTargetChip targets={parsedEdit.targets} /> : null}

        {isEditing ? (
          <div className="w-full max-w-[80%] flex flex-col gap-2">
            <textarea
              ref={editRef}
              value={editContent}
              onChange={(event) => setEditContent(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setIsEditing(false);
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void handleEditSubmit();
                }
              }}
              className="min-h-24 w-full resize-y rounded-[12px] border border-[var(--accent)] bg-[var(--surface)] px-3 py-2 text-[15px] leading-relaxed text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
              disabled={isSubmittingEdit}
              aria-label={t("message.edit")}
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setEditContent(userDisplayText || message.content); setIsEditing(false); }}
                className="rounded-[7px] px-2.5 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--hover)] cursor-pointer"
                disabled={isSubmittingEdit}
              >
                {t("message.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void handleEditSubmit()}
                className="rounded-[7px] bg-[var(--accent)] px-2.5 py-1.5 text-xs text-white hover:opacity-90 cursor-pointer disabled:opacity-50"
                disabled={isSubmittingEdit || !editContent.trim()}
              >
                {isSubmittingEdit ? "..." : t("message.saveAndSubmit")}
              </button>
            </div>
          </div>
        ) : userDisplayText ? (
          <div className="max-w-[80%] px-4 py-3 rounded-[16px] rounded-br-[6px] bg-[var(--bubble-user)] text-[var(--bubble-user-text)] border border-[var(--border)] shadow-xs select-text text-[15px] leading-relaxed whitespace-pre-wrap break-words">
            {userDisplayText}
          </div>
        ) : null}
        {!isEditing ? (
          <div className="mt-1 flex items-center justify-end gap-1 select-none opacity-0 group-hover:opacity-100 transition-opacity">
            {formattedTime ? <span className="text-[11px] text-[var(--muted)] px-0.5">{formattedTime}</span> : null}
            {onEditSubmit ? (
              <>
                <Tooltip content={t("message.copy")} side="top">
                  <button type="button" onClick={handleCopy} className="grid place-items-center w-6 h-6 rounded-[5px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] cursor-pointer transition-colors" aria-label={t("message.copy")}>
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </Tooltip>
                <Tooltip content={t("message.edit")} side="top">
                  <button type="button" onClick={() => setIsEditing(true)} className="grid place-items-center w-6 h-6 rounded-[5px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] cursor-pointer transition-colors" aria-label={t("message.edit")}>
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </Tooltip>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  const isToolRunning = Boolean(
    message.toolCalls?.some(
      (tool) => tool.state === "running" || tool.state === "streaming" || (!tool.output && !tool.error)
    )
  );
  const isToolPhase = Boolean(
    isToolRunning || (message.toolCalls && message.toolCalls.length > 0 && !hasContent)
  );

  // Balasan yang dibatalkan sebelum ada teks/aktivitas: biarkan kosong tanpa action bar
  if (!isStreaming && !hasContent && !hasActivity && donePhase === "idle") return null;

  // A failed reply is a red card with the friendly line and its request id, not chat prose
  const errorCard = message.errorRequestId ? (
    <MessageErrorCard message={message.content} requestId={message.errorRequestId} />
  ) : null;

  const hasTools = Boolean(message.toolCalls && message.toolCalls.length > 0);
  let lastWorkIdx = -1;
  if (hasTools && message.segments?.length) {
    for (let i = message.segments.length - 1; i >= 0; i--) {
      if (message.segments[i].type === "tools" || message.segments[i].type === "reasoning") {
        lastWorkIdx = i;
        break;
      }
    }
  }

  return (
    <div id={`message-${message.id}`} className="py-4 group min-w-0">
      {message.segments?.length ? (
        lastWorkIdx >= 0 && message.toolCalls ? (
          <>
            <AgentWorkAccordion
              segments={message.segments.slice(0, lastWorkIdx + 1)}
              tools={message.toolCalls}
              messageId={message.id}
              chatId={chatId}
              isMessageStreaming={isStreaming}
              isWorkActive={Boolean(
                isStreaming &&
                  (isToolRunning ||
                    message.isReasoningStreaming ||
                    lastWorkIdx === message.segments.length - 1)
              )}
              sourcesMap={sourcesMap}
            />
            {errorCard ??
              message.segments.slice(lastWorkIdx + 1).map((segment, idx, arr) => {
                if (segment.type !== "text") return null;
                const isLast = idx === arr.length - 1;
                return (
                  <div
                    key={`final-text-${idx}`}
                    className={cn("prose-chat", !isLast && "mb-3", isStreaming && isLast && "typewriter-fade-in")}
                  >
                    <MarkdownRenderer content={segment.text} sourcesMap={sourcesMap} />
                  </div>
                );
              })}
          </>
        ) : (
          // No tools used: render reasoning & text segments directly
          message.segments.map((segment, idx) => {
            const isLast = idx === message.segments!.length - 1;
            if (segment.type === "reasoning") {
              return <ThinkingAccordion key={`reasoning-${idx}`} content={segment.text} durationSec={segment.durationSec} isStreaming={isStreaming && isLast && !hasContent} />;
            }
            if (segment.type === "tools") {
              return <ToolActivityList key={`tools-${segment.tools[0]?.id ?? idx}`} tools={segment.tools} messageId={message.id} chatId={chatId} isMessageStreaming={isStreaming} />;
            }
            if (errorCard && isLast) return <React.Fragment key={`text-${idx}`}>{errorCard}</React.Fragment>;
            return (
              <div key={`text-${idx}`} className={cn("prose-chat", !isLast && "mb-3", isStreaming && isLast && "typewriter-fade-in")}>
                <MarkdownRenderer content={segment.text} sourcesMap={sourcesMap} />
              </div>
            );
          })
        )
      ) : (
        <>
          {message.toolCalls?.length ? (
            <ToolActivityList tools={message.toolCalls} messageId={message.id} chatId={chatId} isMessageStreaming={isStreaming} />
          ) : null}
          {errorCard ? (
            errorCard
          ) : hasContent ? (
            <div className={cn("prose-chat", isStreaming && "typewriter-fade-in")}>
              <MarkdownRenderer content={message.content} sourcesMap={sourcesMap} />
            </div>
          ) : null}
        </>
      )}

      <TurnGeneratedFiles tools={message.toolCalls} chatId={chatId} />

      {isStreaming ? (
        <div className="mt-2.5">
          {requestRetry && !hasContent ? (
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/[0.07] px-2.5 py-1 text-[12px] text-amber-400">
              <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
              {t("message.requestAttempt", { attempt: requestRetry.attempt, max: requestRetry.max })}
            </div>
          ) : null}
          {message.isReasoningStreaming ? (
            <TypingIndicator state="thinking" size="md" showLabel={true} />
          ) : isToolPhase ? (
            <TypingIndicator state="tools" size="md" showLabel={true} />
          ) : !hasContent && !hasActivity ? (
            <TypingIndicator state="normal" size="md" showLabel={true} labelKey="processing" />
          ) : (
            <TypingIndicator state="normal" size="md" showLabel={true} className="py-1 mt-1.5" />
          )}
        </div>
      ) : donePhase !== "idle" ? (
        <div className="mt-2.5">
          <TypingIndicator state="done" size="md" showLabel={true} isExiting={donePhase === "exiting"} />
        </div>
      ) : (
        <div className="flex items-center gap-2 mt-2.5 animate-fade-in">
          <div className="flex items-center gap-0.5">
            <Tooltip content={copied ? t("message.copied") : t("message.copy")} side="top">
              <button
                type="button"
                onClick={handleCopy}
                className={cn("grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer", copied && "text-[var(--accent)]")}
                aria-label={copied ? t("message.copied") : t("message.copy")}
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </Tooltip>
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
            {chatId ? (
              <>
                <span className="w-px h-3.5 bg-[var(--border)] mx-1" aria-hidden="true" />
                <Tooltip content={t("message.like")} side="top">
                  <button
                    type="button"
                    aria-pressed={effectiveFeedback === "like"}
                    onClick={() => handleFeedback("like")}
                    className={cn(
                      "grid place-items-center w-7 h-7 rounded-[6px] transition-colors cursor-pointer",
                      effectiveFeedback === "like"
                        ? "text-[var(--ink)] bg-[var(--accent-soft)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                        : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                    )}
                    aria-label={t("message.like")}
                  >
                    <ThumbsUp className={cn("w-3.5 h-3.5", effectiveFeedback === "like" && "fill-current")} />
                  </button>
                </Tooltip>
                <Tooltip content={t("message.dislike")} side="top">
                  <button
                    type="button"
                    aria-pressed={effectiveFeedback === "dislike"}
                    onClick={() => handleFeedback("dislike")}
                    className={cn(
                      "grid place-items-center w-7 h-7 rounded-[6px] transition-colors cursor-pointer",
                      effectiveFeedback === "dislike"
                        ? "text-[var(--ink)] bg-[var(--accent-soft)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                        : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                    )}
                    aria-label={t("message.dislike")}
                  >
                    <ThumbsDown className={cn("w-3.5 h-3.5", effectiveFeedback === "dislike" && "fill-current")} />
                  </button>
                </Tooltip>
              </>
            ) : null}
          </div>
          {formattedTime ? (
            <span className="text-[11px] text-[var(--muted)] select-none px-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {formattedTime}
            </span>
          ) : null}
        </div>
      )}

      <FeedbackModal
        isOpen={isFeedbackModalOpen}
        loading={isSubmittingFeedback}
        onClose={() => { setIsFeedbackModalOpen(false); toast(t("message.feedbackRecorded")); }}
        onSubmit={handleSubmitDislikeDetails}
      />
    </div>
  );
});
