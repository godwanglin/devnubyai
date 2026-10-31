"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { ArrowDown } from "lucide-react";
import { MessageBubble } from "./message-bubble";
import { TypingIndicator } from "./typing-indicator";
import {
  DevnubyLoaderMascot,
  useLookAtCursor,
  type DevnubyLoaderState,
} from "@/components/brand/devnuby-loader";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/providers/i18n-provider";
import { cn } from "@/lib/cn";
import type { Message } from "@/types";

interface MessageListProps {
  messages: Message[];
  chatId?: string;
  isThinking?: boolean;
  streamingId?: string | null;
  onRegenerate?: (id: string) => void;
  onEditSubmit?: (messageId: string, content: string) => Promise<void>;
  onLoadOlder?: () => void;
  hasOlderMessages?: boolean;
  isLoadingOlder?: boolean;
}

export function MessageList({
  messages,
  chatId,
  isThinking,
  streamingId,
  onRegenerate,
  onEditSubmit,
  onLoadOlder,
  hasOlderMessages = false,
  isLoadingOlder = false,
}: MessageListProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  // true = ikuti konten ke bawah (auto-scroll). Dilepas begitu user scroll ke atas.
  const stickRef = useRef(true);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const isEmpty = messages.length === 0 && !isThinking;

  const isGenerating = Boolean(isThinking || streamingId);
  const [scrollDone, setScrollDone] = useState(false);
  const prevGeneratingRef = useRef(isGenerating);

  useEffect(() => {
    const wasGen = prevGeneratingRef.current;
    prevGeneratingRef.current = isGenerating;
    if (wasGen && !isGenerating) {
      setScrollDone(true);
      const timer = setTimeout(() => setScrollDone(false), 1000);
      return () => clearTimeout(timer);
    }
  }, [isGenerating]);

  const showLoaderOnButton = isGenerating || scrollDone;
  const { targetRef, tracking } = useLookAtCursor(showLoaderOnButton);

  const streamingMsg = streamingId ? messages.find((m) => m.id === streamingId) : null;
  const activeLoaderState: DevnubyLoaderState = scrollDone
    ? "done"
    : streamingMsg?.isReasoningStreaming
    ? "thinking"
    : streamingMsg?.toolCalls?.some(
        (t) => t.state === "running" || t.state === "streaming" || (!t.output && !t.error)
      )
    ? "tools"
    : "normal";

  const scrollToBottom = useCallback((smooth = true) => {
    const scroller = containerRef.current?.parentElement;
    if (!scroller) return;
    stickRef.current = true;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Pesan baru dari user → selalu kembali menempel ke bawah
  const lastRole = messages[messages.length - 1]?.role;
  useEffect(() => {
    if (lastRole === "user") scrollToBottom(false);
  }, [messages.length, lastRole, scrollToBottom]);

  // Throttle trigger pagination to prevent rapid duplicate requests
  const loadingTriggeredRef = useRef(false);

  useEffect(() => {
    if (!isLoadingOlder) {
      loadingTriggeredRef.current = false;
    }
  }, [isLoadingOlder]);

  useEffect(() => {
    const container = containerRef.current;
    const scroller = container?.parentElement;
    if (!container || !scroller) return;

    let lastTop = scroller.scrollTop;
    let rafId: number | null = null;

    function updateButton() {
      if (!scroller) return;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!scroller) return;
        const { scrollTop, scrollHeight, clientHeight } = scroller;
        const distance = scrollHeight - scrollTop - clientHeight;
        setShowScrollBottom((prev) => {
          // Hysteresis deadband: appear when > 48px from bottom, disappear when <= 12px
          if (!prev && distance > 48) return true;
          if (prev && distance <= 12) return false;
          return prev;
        });
      });
    }

    function handleScroll() {
      const { scrollTop, scrollHeight, clientHeight } = scroller!;
      const distance = scrollHeight - scrollTop - clientHeight;
      if (scrollTop < lastTop - 1) {
        stickRef.current = false;
        if (scrollTop <= 80 && hasOlderMessages && !isLoadingOlder && !loadingTriggeredRef.current) {
          loadingTriggeredRef.current = true;
          onLoadOlder?.();
        }
      } else if (distance <= 24) stickRef.current = true;
      lastTop = scrollTop;
      updateButton();
    }

    // Lepas auto-scroll seketika saat user menggulir ke atas, sebelum konten
    // berikutnya sempat menarik posisi kembali ke bawah.
    function handleWheel(e: WheelEvent) {
      if (e.deltaY < 0) stickRef.current = false;
    }
    let touchY = 0;
    function handleTouchStart(e: TouchEvent) {
      touchY = e.touches[0]?.clientY ?? 0;
    }
    function handleTouchMove(e: TouchEvent) {
      if ((e.touches[0]?.clientY ?? 0) > touchY) stickRef.current = false;
    }

    // Ikuti pertumbuhan konten (streaming token, markdown, gambar) secara instan
    const observer = new ResizeObserver(() => {
      if (stickRef.current) {
        scroller.scrollTop = scroller.scrollHeight;
        lastTop = scroller.scrollTop;
      }
      updateButton();
    });
    observer.observe(container);

    scroller.addEventListener("scroll", handleScroll, { passive: true });
    scroller.addEventListener("wheel", handleWheel, { passive: true });
    scroller.addEventListener("touchstart", handleTouchStart, { passive: true });
    scroller.addEventListener("touchmove", handleTouchMove, { passive: true });
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      observer.disconnect();
      scroller.removeEventListener("scroll", handleScroll);
      scroller.removeEventListener("wheel", handleWheel);
      scroller.removeEventListener("touchstart", handleTouchStart);
      scroller.removeEventListener("touchmove", handleTouchMove);
    };
  }, [hasOlderMessages, isEmpty, isLoadingOlder, onLoadOlder]);

  if (isEmpty) return null;

  return (
    <div ref={containerRef} className="relative max-w-[768px] mx-auto px-4 sm:px-5 pb-32">
      {isLoadingOlder ? (
        <div className="flex justify-center py-3">
          <div className="w-5 h-5 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
        </div>
      ) : null}

      {messages.map((msg, i) => (
        <MessageBubble
          key={msg.id}
          message={msg}
          chatId={chatId}
          isStreaming={msg.id === streamingId}
          onRegenerate={
            msg.role === "assistant" && i === messages.length - 1
              ? () => onRegenerate?.(msg.id)
              : undefined
          }
          onEditSubmit={msg.role === "user" ? onEditSubmit : undefined}
        />
      ))}
      {isThinking && !streamingId && (
        <TypingIndicator state="normal" size="md" showLabel={true} labelKey="processing" />
      )}

      {/* Floating Scroll to Bottom Button (centered within the chat content shell) */}
      <div
        aria-hidden={!showScrollBottom}
        className={cn(
          "sticky bottom-4 mx-auto w-fit z-20 transition-[opacity,transform,visibility] duration-200 ease-out",
          showScrollBottom
            ? "visible opacity-100 translate-y-0 scale-100 pointer-events-auto"
            : "invisible opacity-0 translate-y-2 scale-90 pointer-events-none"
        )}
      >
        <Tooltip content={t("message.scrollToBottom")} side="top">
          <button
            type="button"
            onClick={() => scrollToBottom(true)}
            className={cn(
              "glass flex items-center justify-center rounded-full text-[var(--muted)]",
              "hover:text-[var(--ink)] active:scale-95 transition-all duration-300 ease-out cursor-pointer",
              showLoaderOnButton
                ? "w-9.5 h-9.5 shadow-lg shadow-cyan-500/15 border-cyan-400/40"
                : "w-8 h-8"
            )}
            aria-label={t("message.scrollToBottom")}
          >
            {showLoaderOnButton ? (
              <div
                ref={targetRef as React.RefObject<HTMLDivElement>}
                className="w-full h-full flex items-center justify-center overflow-visible dn-loader-enter"
              >
                <DevnubyLoaderMascot
                  state={activeLoaderState}
                  tracking={tracking}
                  className="w-full h-full scale-[1.7] -translate-y-0.5 overflow-visible"
                />
              </div>
            ) : (
              <ArrowDown className="w-4 h-4" />
            )}
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
