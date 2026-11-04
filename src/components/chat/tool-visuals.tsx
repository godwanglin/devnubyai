"use client";

import React, { useState } from "react";
import { ImagePreviewModal, type PreviewImageTarget } from "@/components/modals/image-preview-modal";
import { cn } from "@/lib/cn";
import type { ToolActivity } from "@/types";
import type { StandaloneChartFigure } from "./code-execution-widget";

export interface ToolVisual {
  url: string;
  title: string;
  /** Charts are matplotlib-style figures on white; images are shown edge-to-edge. */
  kind: "chart" | "image";
}

export type LiveChartsMap = Record<string, StandaloneChartFigure[]>;

export function extractPersistedCharts(output: unknown): StandaloneChartFigure[] {
  if (!output || typeof output !== "object") return [];
  const exec = (output as Record<string, unknown>).executionResult;
  if (!exec || typeof exec !== "object") return [];
  const charts = (exec as Record<string, unknown>).charts;
  if (!Array.isArray(charts)) return [];
  return charts
    .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === "object" && c.url))
    .map((c, idx) => ({
      url: String(c.url),
      title: String(c.title || `Chart ${idx + 1}`),
    }));
}

/** Returns `prev` untouched when the chart URLs are unchanged, to avoid re-render loops. */
export function mergeLiveCharts(
  prev: LiveChartsMap,
  toolCallId: string,
  nextCharts: StandaloneChartFigure[]
): LiveChartsMap {
  const current = prev[toolCallId];
  if (
    current &&
    current.length === nextCharts.length &&
    current.every((c, idx) => c.url === nextCharts[idx]?.url)
  ) {
    return prev;
  }
  return { ...prev, [toolCallId]: nextCharts };
}

/** Resolves the session-file URL of a completed `generate_image` call, or null. */
export function generatedImageUrl(tool: ToolActivity, chatId?: string): string | null {
  if (tool.name !== "generate_image" || tool.state !== "completed") return null;
  const raw = (tool.output && typeof tool.output === "object" ? tool.output : {}) as Record<string, unknown>;
  const out = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown>;
  const url = typeof out.url === "string" ? out.url : "";
  if (url.startsWith("/api/v1/")) return url;
  if (chatId && typeof out.id === "string") return `/api/v1/chats/${chatId}/files/${out.id}`;
  return url || null;
}

function generatedImageTitle(tool: ToolActivity): string {
  const raw = (tool.output && typeof tool.output === "object" ? tool.output : {}) as Record<string, unknown>;
  const out = (raw.data && typeof raw.data === "object" ? raw.data : raw) as Record<string, unknown>;
  return String(out.displayName || out.filename || "Generated image");
}

/** Visual results (execute_code charts, generate_image outputs) of a turn, in call order. */
export function collectToolVisuals(
  tools: ToolActivity[],
  liveCharts: LiveChartsMap,
  chatId?: string
): ToolVisual[] {
  const out: ToolVisual[] = [];
  for (const tool of tools) {
    if (tool.name === "execute_code") {
      const fromLive = liveCharts[tool.id];
      const charts = fromLive !== undefined ? fromLive : extractPersistedCharts(tool.output);
      for (const ch of charts) {
        if (ch.url) out.push({ url: ch.url, title: ch.title, kind: "chart" });
      }
      continue;
    }
    const imageUrl = generatedImageUrl(tool, chatId);
    if (imageUrl) out.push({ url: imageUrl, title: generatedImageTitle(tool), kind: "image" });
  }
  return out;
}

/** Click-to-zoom gallery shown directly in the conversation flow, outside any tool trace. */
export function ToolVisualGallery({ visuals }: { visuals: ToolVisual[] }) {
  const [previewImage, setPreviewImage] = useState<PreviewImageTarget | null>(null);

  if (visuals.length === 0) return null;

  return (
    <>
      <div
        className={cn(
          "my-3.5 grid gap-3",
          visuals.length > 1 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1"
        )}
      >
        {visuals.map((visual, idx) => (
          <button
            key={`${visual.url}-${idx}`}
            type="button"
            onClick={() => setPreviewImage({ url: visual.url, title: visual.title })}
            className={cn(
              "block w-full max-w-[680px] rounded-[12px] border border-[var(--border)] overflow-hidden cursor-zoom-in transition-opacity hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-[var(--border)]",
              visual.kind === "chart" ? "bg-white p-2.5" : "bg-[var(--panel-elevated)]"
            )}
            aria-label={visual.title}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={visual.url}
              alt={visual.title}
              className={cn(
                "w-full object-contain mx-auto",
                visual.kind === "chart" ? "max-h-[420px] rounded-[6px]" : "max-h-[520px]"
              )}
            />
          </button>
        ))}
      </div>

      <ImagePreviewModal image={previewImage} onClose={() => setPreviewImage(null)} />
    </>
  );
}
