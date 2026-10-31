"use client";

import React, { useEffect, useRef, useState } from "react";
import { Brain, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";

interface ThinkingAccordionProps {
  content: string;
  durationSec?: number;
  isStreaming?: boolean;
}

/** Brain icon with soft pulse during live thinking */
function ThinkingGlyph({ active }: { active?: boolean }) {
  return (
    <Brain
      className={cn(
        "w-4 h-4 shrink-0 text-[var(--accent)] transition-transform",
        active && "animate-pulse"
      )}
      aria-hidden="true"
    />
  );
}

export function ThinkingAccordion({ content, durationSec, isStreaming }: ThinkingAccordionProps) {
  const { t } = useI18n();

  // default: chat lama selalu collapse (false).
  // Saat streaming thinking aktif pertama kali, otomatis terbuka (true).
  const [isOpen, setIsOpen] = useState(Boolean(isStreaming));
  const userInteractedRef = useRef(false);
  const wasStreamingRef = useRef(Boolean(isStreaming));

  // Durasi live atau durasi tersimpan dari database saat reload
  const startRef = useRef<number | null>(null);
  const [seconds, setSeconds] = useState<number | null>(durationSec ?? null);

  const [prevDurationSec, setPrevDurationSec] = useState(durationSec);
  if (prevDurationSec !== durationSec) {
    setPrevDurationSec(durationSec);
    if (!isStreaming && durationSec !== undefined) {
      setSeconds(durationSec);
    }
  }

  useEffect(() => {
    if (isStreaming) {
      wasStreamingRef.current = true;
      if (!userInteractedRef.current) {
        setIsOpen(true);
      }
      if (startRef.current === null) startRef.current = Date.now();
      const start = startRef.current;
      const tick = () => setSeconds(Math.max(1, Math.round((Date.now() - start) / 1000)));
      tick();
      const interval = setInterval(tick, 1000);
      return () => {
        clearInterval(interval);
        tick();
      };
    }

    // Transisi dari streaming thinking -> selesai:
    // Otomatis tertutup jika user belum pernah mengklik/override manual
    if (wasStreamingRef.current && !userInteractedRef.current) {
      setIsOpen(false);
    }
  }, [isStreaming]);

  function handleToggle() {
    userInteractedRef.current = true;
    setIsOpen((prev) => !prev);
  }

  const effectiveSeconds = seconds ?? durationSec ?? null;
  const label = isStreaming
    ? t("message.thinking")
    : effectiveSeconds !== null
      ? t("message.thoughtFor", { seconds: effectiveSeconds })
      : t("message.thoughtProcess");

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={handleToggle}
        className="group inline-flex items-center gap-2 -ml-1.5 px-1.5 py-1 rounded-[8px] text-[13.5px] font-medium cursor-pointer select-none transition-colors hover:bg-[var(--hover)]"
        aria-expanded={isOpen}
      >
        <ThinkingGlyph active={isStreaming} />
        <span
          className={cn(
            "transition-colors",
            isStreaming
              ? "text-shimmer"
              : "text-[var(--muted)] group-hover:text-[var(--ink)]"
          )}
        >
          {label}
          {isStreaming && seconds !== null ? ` · ${seconds}s` : null}
        </span>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 text-[var(--muted)] transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {/* grid-rows trick: animasi buka/tutup halus tanpa mengukur tinggi */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        )}
      >
        <div className="overflow-hidden">
          <div className="mt-1.5 ml-[7px] pl-4 border-l border-[var(--border)]">
            <div className="prose-chat thinking-prose text-[13.5px] leading-relaxed text-[var(--muted)] [&_*]:!text-[var(--muted)]">
              <MarkdownRenderer content={content} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
