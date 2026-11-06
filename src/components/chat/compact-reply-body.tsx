"use client";

import React from "react";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import { cn } from "@/lib/cn";
import type { CompactWebSource } from "@/lib/tools/compact-source";
import type { Message } from "@/types";
import { AgentWorkAccordion } from "./agent-work-accordion";
import { CompactThinkingLine, CompactToolList, ToolResults } from "./compact-activity";

interface CompactReplyBodyProps {
  message: Message;
  chatId?: string;
  isStreaming?: boolean;
  mode: "normal" | "silent";
  sourcesMap: Map<string, CompactWebSource>;
  /** Shown instead of the answer text when the reply failed */
  errorCard: React.ReactNode;
  /** Index of the last reasoning/tools segment when tools were used, else -1 */
  lastWorkIdx: number;
  /** The work drawer is live (tools running, thinking, or work is the newest segment) */
  isWorkActive: boolean;
}

/**
 * An assistant reply in the "normal" and "silent" response modes.
 * - normal: when tools were used, all the work sits in one collapsible "Worked for Xs"
 *   drawer (open while working, collapsed once the answer starts) listing single lines;
 *   without tools, thinking is a single line above the text.
 * - silent: only the answer (the live status line is rendered by the bubble).
 * Tool results (charts, images, quizzes) show in both.
 */
export function CompactReplyBody({
  message,
  chatId,
  isStreaming,
  mode,
  sourcesMap,
  errorCard,
  lastWorkIdx,
  isWorkActive,
}: CompactReplyBodyProps) {
  const segments = message.segments ?? [];
  const answerStart = lastWorkIdx + 1;

  const toolResults = message.toolCalls?.length ? (
    <ToolResults tools={message.toolCalls} messageId={message.id} chatId={chatId} isMessageStreaming={isStreaming} />
  ) : null;

  const renderText = (text: string, key: string, isLast: boolean) => (
    <div key={key} className={cn("prose-chat", !isLast && "mb-3", isStreaming && isLast && "typewriter-fade-in")}>
      <MarkdownRenderer content={text} sourcesMap={sourcesMap} />
    </div>
  );

  // Legacy messages without segments: tool calls, then the content
  if (segments.length === 0) {
    return (
      <>
        {mode === "normal" && message.toolCalls?.length ? <CompactToolList tools={message.toolCalls} /> : null}
        {toolResults}
        {errorCard ?? (message.content.trim() ? renderText(message.content, "content", true) : null)}
      </>
    );
  }

  const answer = segments.slice(answerStart).map((segment, i) => {
    const idx = i + answerStart;
    const isLast = idx === segments.length - 1;
    if (segment.type === "reasoning") {
      return mode === "normal" ? (
        <CompactThinkingLine
          key={`reasoning-${idx}`}
          content={segment.text}
          durationSec={segment.durationSec}
          isStreaming={isStreaming && isLast}
        />
      ) : null;
    }
    if (segment.type === "tools" || errorCard) return null;
    return renderText(segment.text, `text-${idx}`, isLast);
  });

  return (
    <>
      {mode === "normal" && lastWorkIdx >= 0 && message.toolCalls ? (
        <AgentWorkAccordion
          compact
          segments={segments.slice(0, answerStart)}
          tools={message.toolCalls}
          messageId={message.id}
          chatId={chatId}
          isMessageStreaming={isStreaming}
          isWorkActive={isWorkActive}
          sourcesMap={sourcesMap}
        />
      ) : null}
      {toolResults}
      {answer}
      {errorCard}
    </>
  );
}
