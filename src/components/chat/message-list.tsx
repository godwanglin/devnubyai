"use client";

import React, { useEffect, useRef } from "react";
import { MessageBubble } from "./message-bubble";
import { TypingIndicator } from "./typing-indicator";
import type { Message } from "@/types";

interface MessageListProps {
  messages: Message[];
  isThinking?: boolean;
  streamingId?: string | null;
  onRegenerate?: (id: string) => void;
}

export function MessageList({
  messages,
  isThinking,
  streamingId,
  onRegenerate,
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, isThinking]);

  if (messages.length === 0 && !isThinking) return null;

  return (
    <div className="max-w-[768px] mx-auto px-4 sm:px-5 pb-32">
      {messages.map((msg, i) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          isStreaming={msg.id === streamingId}
          onRegenerate={
            msg.role === "assistant" && i === messages.length - 1
              ? () => onRegenerate?.(msg.id)
              : undefined
          }
        />
      ))}
      {isThinking && !streamingId && <TypingIndicator />}
      <div ref={endRef} className="h-px" />
    </div>
  );
}
