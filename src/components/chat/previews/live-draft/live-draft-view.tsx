"use client";

import React, { useEffect, useRef, useState } from "react";
import { MarkdownRenderer } from "@/components/ui/markdown-renderer";
import type { DraftDocument, DraftSection } from "@/lib/live-draft/types";
import { useI18n } from "@/providers/i18n-provider";
import { DraftCaret } from "./draft-inline";
import { DraftFixedPage } from "./draft-fixed-page";
import { DraftFlowPages } from "./draft-flow-pages";
import { DraftSheets } from "./draft-sheets";

const MAX_SCALE = 1.4;
const MIN_SCALE = 0.2;
const STICK_THRESHOLD = 120;

/** Where the caret goes: the last item still being typed, in the last section that has one. */
function caretTarget(draft: DraftDocument): { section: number; index: number } {
  if (!draft.typing) return { section: -1, index: -1 };
  for (let s = draft.sections.length - 1; s >= 0; s -= 1) {
    const section = draft.sections[s];
    if (section.kind === "flow") {
      for (let i = section.blocks.length - 1; i >= 0; i -= 1) {
        const block = section.blocks[i];
        if ((block.type === "text" || block.type === "table" || block.type === "callout") && block.typing) return { section: s, index: i };
      }
    } else if (section.kind === "fixed") {
      for (let i = section.items.length - 1; i >= 0; i -= 1) {
        const item = section.items[i];
        if (item.type === "text" && item.typing) return { section: s, index: i };
      }
    }
  }
  return { section: -1, index: -1 };
}

function widestPage(sections: DraftSection[]): number {
  let widest = 0;
  for (const section of sections) {
    if (section.kind === "flow" || section.kind === "fixed") widest = Math.max(widest, section.page.width);
  }
  return widest || 595;
}

/**
 * Page-shaped live draft of the document being written: paginated flow pages, canvas
 * pages / slides, sheet grids, Markdown or HTML. Follows the newest content while the
 * user stays at the bottom.
 */
export function LiveDraftView({ draft }: { draft: DraftDocument }) {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setContainerWidth((prev) => (Math.abs(prev - width) < 1 ? prev : width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Follow the writing unless the user scrolled up to read
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  });

  const scale = containerWidth > 0 ? Math.min(MAX_SCALE, Math.max(MIN_SCALE, (containerWidth - 32) / widestPage(draft.sections))) : 0;
  const caret = caretTarget(draft);

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        const el = e.currentTarget;
        stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_THRESHOLD;
      }}
      className="relative flex-1 min-h-0 overflow-auto bg-[var(--surface)] px-4 py-4"
    >
      {scale > 0
        ? draft.sections.map((section, s) => {
            switch (section.kind) {
              case "flow":
                return <DraftFlowPages key={s} page={section.page} blocks={section.blocks} caretIndex={caret.section === s ? caret.index : -1} scale={scale} />;
              case "fixed":
                return (
                  <DraftFixedPage
                    key={s}
                    page={section.page}
                    background={section.background}
                    items={section.items}
                    caretItem={caret.section === s ? caret.index : -1}
                    scale={scale}
                  />
                );
              case "sheets":
                return (
                  <div key={s} className="mb-4">
                    <DraftSheets sheets={section.sheets} typing={draft.typing} />
                  </div>
                );
              case "markdown":
                return (
                  <div key={s} className="mx-auto mb-4 max-w-[760px] rounded-[8px] border border-[var(--border)] bg-[var(--panel-elevated)] px-5 py-4">
                    <MarkdownRenderer content={section.text} />
                    {section.typing ? <DraftCaret /> : null}
                  </div>
                );
              case "html":
                return (
                  <iframe
                    key={s}
                    title={t("chatFiles.liveTabDraft")}
                    sandbox=""
                    srcDoc={section.html}
                    className="mx-auto mb-4 block h-[70vh] w-full rounded-[6px] border border-[var(--border)] bg-white"
                  />
                );
              default:
                return null;
            }
          })
        : null}
    </div>
  );
}
