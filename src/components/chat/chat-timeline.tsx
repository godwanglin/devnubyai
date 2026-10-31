"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, MessageSquareQuote } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";
import type { Message } from "@/types";

export interface ChatTimelineProps {
  chatId?: string | null;
  messages: Message[];
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onLoadOlder?: (options?: {
    limit?: number;
    targetMessageId?: string;
  }) => Promise<void> | void;
  hasOlderMessages?: boolean;
  isLoadingOlder?: boolean;
}

interface ServerTimelineTurn {
  id: string;
  index: number;
  messageIndex: number;
  userSnippet: string;
  assistantSnippet: string;
  createdAt: string;
}

interface ChatTurn {
  id: string; // user message id
  index: number;
  messageIndex: number;
  userSnippet: string;
  assistantSnippet: string;
  timestamp: string;
  isLoaded: boolean;
}

function formatTurnTime(isoString?: string): string {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "";
  }
}

export function ChatTimeline({
  chatId,
  messages,
  scrollContainerRef,
  onLoadOlder,
  hasOlderMessages = false,
  isLoadingOlder = false,
}: ChatTimelineProps) {
  const { t } = useI18n();
  const trackRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [serverTurns, setServerTurns] = useState<ServerTimelineTurn[]>([]);
  const [serverTotalMessages, setServerTotalMessages] = useState(0);
  const [activeTurnIndex, setActiveTurnIndex] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hoverCardTop, setHoverCardTop] = useState<number>(0);
  const [isColliding, setIsColliding] = useState(false);
  const [isAreaHovered, setIsAreaHovered] = useState(false);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  const [prevChatId, setPrevChatId] = useState(chatId);
  if (prevChatId !== chatId) {
    setPrevChatId(chatId);
    setServerTurns([]);
    setServerTotalMessages(0);
    setHoveredIndex(null);
  }

  const updateTrackScrollState = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    setCanScrollUp(el.scrollTop > 2);
    setCanScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 2);
  }, []);

  // Detect collision width & generous left-edge hover proximity (96px zone)
  // Use refs to avoid state updates on every mousemove event
  const isAreaHoveredRef = useRef(isAreaHovered);
  useEffect(() => {
    isAreaHoveredRef.current = isAreaHovered;
  }, [isAreaHovered]);

  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setIsColliding(entry.contentRect.width < 824);
    });
    observer.observe(scroller);

    const host = scroller.parentElement ?? scroller;
    const handleMouseMove = (e: MouseEvent) => {
      const rect = host.getBoundingClientRect();
      const offsetX = e.clientX - rect.left;
      const offsetY = e.clientY - rect.top;
      if (offsetX >= 0 && offsetX <= 96 && offsetY >= 48 && offsetY <= rect.height - 48) {
        if (!isAreaHoveredRef.current) setIsAreaHovered(true);
      } else if (offsetX > 120 && !containerRef.current?.matches(":hover")) {
        if (isAreaHoveredRef.current) setIsAreaHovered(false);
      }
    };
    host.addEventListener("mousemove", handleMouseMove, { passive: true });

    return () => {
      observer.disconnect();
      host.removeEventListener("mousemove", handleMouseMove);
    };
  }, [scrollContainerRef, containerRef]);

  // 1. Fetch lightweight timeline metadata (all turns without rendering HTML)
  useEffect(() => {
    if (!chatId) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/v1/chats/${chatId}/timeline`, { credentials: "same-origin" });
        if (!res.ok) return;
        const json = await res.json();
        if (!active || !json?.data || !Array.isArray(json.data.turns)) return;
        setServerTurns(json.data.turns);
        setServerTotalMessages(typeof json.data.totalMessages === "number" ? json.data.totalMessages : 0);
      } catch {
        // Ignore transient network errors; falls back to loaded messages
      }
    })();
    return () => {
      active = false;
    };
  }, [chatId]);

  // 2. Merge unloaded historical server turns + live loaded client turns
  const { turns, firstLoadedMessageIndex } = useMemo(() => {
    const localTurns: Array<{
      id: string;
      userSnippet: string;
      assistantSnippet: string;
      timestamp: string;
    }> = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === "user") {
        const nextMsg = messages[i + 1];
        const assistantContent =
          nextMsg && nextMsg.role === "assistant" ? nextMsg.content : "";

        localTurns.push({
          id: msg.id,
          userSnippet: msg.content,
          assistantSnippet: assistantContent,
          timestamp: formatTurnTime(msg.createdAt),
        });
      }
    }

    if (serverTurns.length > 0 && localTurns.length > 0) {
      const firstLocalId = localTurns[0].id;
      const firstServerMatchIdx = serverTurns.findIndex(
        (st) => st.id === firstLocalId
      );

      if (firstServerMatchIdx > 0) {
        const olderUnloaded = serverTurns
          .slice(0, firstServerMatchIdx)
          .map((st, idx): ChatTurn => ({
            id: st.id,
            index: idx,
            messageIndex: st.messageIndex,
            userSnippet: st.userSnippet,
            assistantSnippet: st.assistantSnippet,
            timestamp: formatTurnTime(st.createdAt),
            isLoaded: false,
          }));

        const firstMsgIdx = serverTurns[firstServerMatchIdx].messageIndex;
        const loadedMapped = localTurns.map((lt, idx): ChatTurn => ({
          id: lt.id,
          index: olderUnloaded.length + idx,
          messageIndex: firstMsgIdx + idx * 2,
          userSnippet: lt.userSnippet,
          assistantSnippet: lt.assistantSnippet,
          timestamp: lt.timestamp,
          isLoaded: true,
        }));

        return {
          turns: [...olderUnloaded, ...loadedMapped],
          firstLoadedMessageIndex: firstMsgIdx,
        };
      }
    }

    if (localTurns.length > 0) {
      return {
        turns: localTurns.map((lt, idx): ChatTurn => ({
          id: lt.id,
          index: idx,
          messageIndex: idx * 2,
          userSnippet: lt.userSnippet,
          assistantSnippet: lt.assistantSnippet,
          timestamp: lt.timestamp,
          isLoaded: true,
        })),
        firstLoadedMessageIndex: 0,
      };
    }

    return {
      turns: serverTurns.map((st, idx): ChatTurn => ({
        id: st.id,
        index: idx,
        messageIndex: st.messageIndex,
        userSnippet: st.userSnippet,
        assistantSnippet: st.assistantSnippet,
        timestamp: formatTurnTime(st.createdAt),
        isLoaded: false,
      })),
      firstLoadedMessageIndex: serverTotalMessages,
    };
  }, [messages, serverTurns, serverTotalMessages]);

  const totalTurns = turns.length;

  // 3. Sync active turn with chat viewport scroll position
  const updateActiveTurn = useCallback(() => {
    const scroller = scrollContainerRef.current;
    if (!scroller || turns.length === 0) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const probeY = scrollerRect.top + scrollerRect.height * 0.35;

    let closestIndex = turns.length - 1;
    let minDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < turns.length; i++) {
      const turn = turns[i];
      if (!turn.isLoaded) continue;
      const el = document.getElementById(`message-${turn.id}`);
      if (!el) continue;

      const rect = el.getBoundingClientRect();
      const dist = Math.abs(rect.top - probeY);
      if (dist < minDistance) {
        minDistance = dist;
        closestIndex = i;
      }
    }

    setActiveTurnIndex(closestIndex);
  }, [scrollContainerRef, turns]);

  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!scroller) return;

    let rafId: number | null = null;
    const handleScroll = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        updateActiveTurn();
        rafId = null;
      });
    };

    scroller.addEventListener("scroll", handleScroll, { passive: true });
    updateActiveTurn();

    return () => {
      scroller.removeEventListener("scroll", handleScroll);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [scrollContainerRef, updateActiveTurn]);

  // 4. Smoothly scroll timeline container to keep active pill visible & update carets
  useEffect(() => {
    const raf = window.requestAnimationFrame(() => {
      const el = trackRef.current;
      if (!el) return;
      setCanScrollUp(el.scrollTop > 2);
      setCanScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 2);
    });
    if (hoveredIndex === null) {
      const activePill = document.getElementById(`timeline-pill-${activeTurnIndex}`);
      if (activePill) {
        activePill.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
    return () => window.cancelAnimationFrame(raf);
  }, [activeTurnIndex, hoveredIndex, totalTurns]);

  // 5. Click pill: jump directly if in DOM, or fetch older slice up to target turn
  const handlePillClick = async (turn: ChatTurn) => {
    const existingEl = document.getElementById(`message-${turn.id}`);
    if (existingEl) {
      existingEl.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (onLoadOlder && hasOlderMessages && !isLoadingOlder) {
      const neededMessages = Math.max(20, firstLoadedMessageIndex - turn.messageIndex + 2);
      await onLoadOlder({ limit: neededMessages, targetMessageId: turn.id });
    }
  };

  // 6. Wave pill hover handlers
  const handlePillMouseEnter = (index: number, e: React.MouseEvent<HTMLButtonElement>) => {
    setHoveredIndex(index);
    if (containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const btnRect = e.currentTarget.getBoundingClientRect();
      setHoverCardTop(btnRect.top - containerRect.top + btnRect.height / 2);
    }
  };

  const shouldHideCapsule = isColliding && !isAreaHovered;

  if (totalTurns === 0) {
    return (
      <aside
        onMouseEnter={() => setIsAreaHovered(true)}
        onMouseLeave={() => setIsAreaHovered(false)}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-30 hidden md:flex flex-col items-center pl-2 sm:pl-2.5 md:pl-3 pr-6 py-12 select-none pointer-events-auto"
        aria-label="Linimasa obrolan"
      >
        <Tooltip content={t("timeline.emptyHint") || "Linimasa obrolan"} side="top" align="start">
          <div
            className={cn(
              "glass w-6 py-2 flex flex-col items-center rounded-full transition-[opacity,transform] duration-200 ease-out",
              shouldHideCapsule && "opacity-0 -translate-x-2 pointer-events-none"
            )}
          >
            <span className="w-1.5 h-[2px] rounded-full bg-zinc-500 block opacity-50" />
          </div>
        </Tooltip>
      </aside>
    );
  }

  const hoveredTurn = hoveredIndex !== null ? turns[hoveredIndex] : null;
  const isScrollable = canScrollUp || canScrollDown;

  return (
    <aside
      ref={containerRef}
      onMouseEnter={() => setIsAreaHovered(true)}
      onMouseLeave={() => {
        setIsAreaHovered(false);
        setHoveredIndex(null);
      }}
      className="absolute left-0 top-1/2 -translate-y-1/2 z-30 hidden md:flex flex-col items-center pl-2 sm:pl-2.5 md:pl-3 pr-6 py-12 select-none pointer-events-auto"
      aria-label="Linimasa obrolan"
    >
      {/* Floating Pill Rail & Track (Translucent glass capsule dock, strictly 0px scrollbar) */}
      <div
        className={cn(
          "glass relative w-6 py-1.5 flex flex-col items-center rounded-full overflow-hidden transition-[opacity,transform] duration-200 ease-out",
          shouldHideCapsule && "opacity-0 -translate-x-2 pointer-events-none"
        )}
      >
        {isScrollable ? (
          <button
            type="button"
            disabled={!canScrollUp}
            onClick={() => trackRef.current?.scrollBy({ top: -120, behavior: "smooth" })}
            className={cn(
              "grid place-items-center w-full pb-0.5 transition-colors shrink-0",
              canScrollUp
                ? "text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer"
                : "text-[var(--placeholder)]/30 cursor-default pointer-events-none"
            )}
            aria-label="Gulir linimasa ke atas"
          >
            <ChevronUp className="w-3 h-3" />
          </button>
        ) : null}

        <div
          ref={trackRef}
          onScroll={updateTrackScrollState}
          style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
          className="relative z-10 w-full flex flex-col items-center gap-[5px] max-h-[340px] overflow-y-auto overflow-x-hidden [&::-webkit-scrollbar]:!w-0 [&::-webkit-scrollbar]:!h-0 [&::-webkit-scrollbar]:!hidden py-0.5"
        >
          {turns.map((turn) => {
            const distance = hoveredIndex !== null ? Math.abs(turn.index - hoveredIndex) : null;
            const isActive = turn.index === activeTurnIndex;

            let widthClass = "w-1.5";
            let heightClass = "h-[2px]";
            let colorClass = "bg-zinc-400/80 dark:bg-zinc-500/80";
            let shadowClass = "";

            if (distance !== null) {
              if (distance === 0) {
                widthClass = "w-3.5";
                heightClass = "h-[3px]";
                colorClass = "bg-zinc-950 dark:bg-white";
                shadowClass = "shadow-[0_0_8px_rgba(255,255,255,0.8)]";
              } else if (distance === 1) {
                widthClass = "w-2.5";
                heightClass = "h-[2.5px]";
                colorClass = "bg-zinc-800/90 dark:bg-white/75";
              } else if (distance === 2) {
                widthClass = "w-2";
                colorClass = "bg-zinc-700/70 dark:bg-white/50";
              } else if (distance === 3) {
                colorClass = "bg-zinc-600/50 dark:bg-white/35";
              } else {
                colorClass = "bg-zinc-500/40 dark:bg-zinc-600/40";
              }
            } else if (isActive) {
              widthClass = "w-3";
              heightClass = "h-[2.5px]";
              colorClass = "bg-[var(--accent)] dark:bg-[var(--accent)]";
              shadowClass = "shadow-[0_0_8px_var(--accent)]";
            }

            return (
              <button
                key={turn.id}
                id={`timeline-pill-${turn.index}`}
                type="button"
                onClick={() => void handlePillClick(turn)}
                onMouseEnter={(e) => handlePillMouseEnter(turn.index, e)}
                className="group w-full flex items-center justify-center py-1 cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] shrink-0"
                aria-label={`Lompat ke pesan ${turn.index + 1}: ${turn.userSnippet.slice(0, 32)}`}
              >
                <span
                  className={cn(
                    "block rounded-full transition-[width,height,background-color,box-shadow,opacity] duration-150 ease-out",
                    widthClass,
                    heightClass,
                    colorClass,
                    shadowClass
                  )}
                />
              </button>
            );
          })}
        </div>

        {isScrollable ? (
          <button
            type="button"
            disabled={!canScrollDown}
            onClick={() => trackRef.current?.scrollBy({ top: 120, behavior: "smooth" })}
            className={cn(
              "grid place-items-center w-full pt-0.5 transition-colors shrink-0",
              canScrollDown
                ? "text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer"
                : "text-[var(--placeholder)]/30 cursor-default pointer-events-none"
            )}
            aria-label="Gulir linimasa ke bawah"
          >
            <ChevronDown className="w-3 h-3" />
          </button>
        ) : null}
      </div>

      {/* Floating Preview Card on Hover */}
      {hoveredTurn ? (
        <div
          style={{ top: `${Math.max(48, Math.min(hoverCardTop, 360))}px` }}
          className="glass absolute left-[calc(100%-4px)] -translate-y-1/2 z-40 pointer-events-none w-[280px] sm:w-[320px] p-3 rounded-[12px] transition-all duration-100 ease-out"
        >
          <div className="flex items-start gap-2">
            <MessageSquareQuote className="w-3.5 h-3.5 mt-0.5 text-[var(--accent)] shrink-0" />
            <p className="font-semibold text-[13px] leading-snug text-[var(--ink)] line-clamp-2 break-words">
              {hoveredTurn.userSnippet}
            </p>
          </div>
          {hoveredTurn.assistantSnippet ? (
            <p className="text-[12px] leading-relaxed text-[var(--muted)] line-clamp-3 break-words mt-1.5 pl-5">
              {hoveredTurn.assistantSnippet}
            </p>
          ) : (
            <p className="text-[11.5px] italic text-[var(--placeholder)] mt-1 pl-5">{t("timeline.generating")}</p>
          )}
          <div className="flex items-center justify-between pt-2 mt-2 border-t border-[var(--divider)] text-[11px] text-[var(--muted)]">
            <span>{hoveredTurn.index + 1} of {totalTurns}</span>
            <span>{hoveredTurn.timestamp}</span>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
