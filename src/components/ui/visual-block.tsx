"use client";

import React, { useEffect, useId, useMemo, useState } from "react";
import { Check, Copy, Download, Loader2 } from "lucide-react";
import { Tooltip } from "./tooltip";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";
import { useTheme } from "@/providers/theme-provider";

export type VisualKind = "svg" | "mermaid";

interface VisualBlockProps {
  kind: VisualKind;
  /** Raw source of the block */
  code: string;
  /** True while the model is still streaming this block's fence */
  isStreaming?: boolean;
  /** Highlighted source, shown on the "Code" tab */
  children: React.ReactNode;
  className?: string;
}

/** Detects code blocks that should render as a visual instead of plain code. */
export function getVisualKind(language: string, code: string): VisualKind | null {
  if (language === "mermaid") return "mermaid";
  if (language === "svg") return "svg";
  if ((language === "xml" || language === "html") && /^\s*<svg[\s>]/i.test(code)) return "svg";
  return null;
}

/**
 * SVG goes through an <img> data URL: the browser never runs scripts or
 * event handlers inside an image, so model output can't execute in the page.
 */
function toSvgDataUrl(svg: string): string {
  const withNs = /<svg[^>]*\sxmlns=/i.test(svg)
    ? svg
    : svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withNs)}`;
}

// Module-level singleton loader so Mermaid imports once across all diagrams
let mermaidPromise: Promise<typeof import("mermaid")> | null = null;
let mermaidRenderQueue: Promise<void> = Promise.resolve();

function getMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid");
  }
  return mermaidPromise;
}

/** Mermaid keeps a small amount of global render state, so serialize renders. */
function enqueueMermaidRender<T>(task: () => Promise<T>): Promise<T> {
  const run = mermaidRenderQueue.then(task, task);
  mermaidRenderQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

type MermaidState =
  | { status: "idle" }
  | { status: "done"; code: string; theme: string; svg: string }
  | { status: "error"; code: string; theme: string };

function cleanupMermaidNodes(id: string) {
  if (typeof document === "undefined") return;
  const selectors = [
    `#d${id}`,
    `#${id}`,
    `[id*="${id}"]`,
    'body > [id^="dmermaid"]',
    'body > iframe[id^="i-mermaid"]',
  ];
  for (const sel of selectors) {
    try {
      document.querySelectorAll(sel).forEach((el) => {
        // Keep elements rendered inside an actual VisualBlock preview container
        if (!el.closest("[data-visual-preview]")) {
          el.remove();
        }
      });
    } catch {}
  }
}

/** Renders Mermaid once the block is final; partial (streaming) code is never parsed. */
function useMermaidSvg(code: string, enabled: boolean) {
  const { theme } = useTheme();
  const rawId = useId();
  const renderId = `mermaid-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const [state, setState] = useState<MermaidState>({ status: "idle" });

  const settled =
    state.status !== "idle" && state.code === code && state.theme === theme;

  useEffect(() => {
    if (!enabled || settled) return;
    let cancelled = false;

    enqueueMermaidRender(async () => {
      if (cancelled) return;

      try {
        const { default: mermaid } = await getMermaid();
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: theme === "dark" ? "dark" : "default",
          fontFamily: "inherit",
        });
        const valid = await mermaid.parse(code, { suppressErrors: true });
        if (!valid) throw new Error("invalid");

        // Use a unique host: Mermaid mutates this element while rendering.
        const sandbox = document.createElement("div");
        sandbox.id = `mermaid-offscreen-${renderId}`;
        sandbox.style.cssText =
          "position:fixed;left:-99999px;top:-99999px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;";
        document.body.appendChild(sandbox);

        try {
          const { svg } = await mermaid.render(renderId, code, sandbox);
          if (!cancelled) setState({ status: "done", code, theme, svg });
        } finally {
          sandbox.remove();
          cleanupMermaidNodes(renderId);
        }
      } catch {
        cleanupMermaidNodes(renderId);
        if (!cancelled) setState({ status: "error", code, theme });
      }
    });

    return () => {
      cancelled = true;
      cleanupMermaidNodes(renderId);
    };
  }, [code, enabled, settled, renderId, theme]);

  return {
    svg: state.status === "done" ? state.svg : null,
    hasError: settled && state.status === "error",
    isRendering: enabled && !settled,
  };
}

export function VisualBlock({ kind, code, isStreaming, children, className }: VisualBlockProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"preview" | "code">("preview");

  // Nothing is rendered until the fence closes, so the preview mounts exactly once
  const final = !isStreaming;
  const mermaid = useMermaidSvg(code, kind === "mermaid" && final);

  const svgDataUrl = useMemo(
    () => (kind === "svg" && final ? toSvgDataUrl(code) : null),
    [kind, final, code]
  );

  const previewSvg = kind === "mermaid" ? mermaid.svg : final ? code : null;
  const hasVisual = Boolean(kind === "mermaid" ? mermaid.svg : svgDataUrl);
  const isBusy = !final || (kind === "mermaid" && mermaid.isRendering);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  function handleDownload() {
    if (!previewSvg) return;
    const url = URL.createObjectURL(new Blob([previewSvg], { type: "image/svg+xml" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = kind === "mermaid" ? "diagram.svg" : "image.svg";
    a.click();
    URL.revokeObjectURL(url);
  }

  const tabClass = (active: boolean) =>
    cn(
      "px-2.5 py-1 rounded-[6px] text-[11.5px] font-medium transition-colors cursor-pointer",
      active
        ? "bg-[var(--hover)] text-[var(--ink)]"
        : "text-[var(--muted)] hover:text-[var(--ink)]"
    );

  const iconButton =
    "grid place-items-center w-7 h-7 rounded-[6px] text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)] transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none";

  return (
    <div
      className={cn(
        "my-4 rounded-[10px] border border-[var(--border)] overflow-hidden bg-[var(--panel)]",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 border-b border-[var(--border)] bg-[var(--surface)] select-none">
        <div className="flex items-center gap-1">
          <span className="px-1.5 text-[12px] font-mono font-medium text-[var(--muted)] lowercase">
            {kind}
          </span>
          <button type="button" onClick={() => setTab("preview")} className={tabClass(tab === "preview")}>
            {t("visual.preview")}
          </button>
          <button type="button" onClick={() => setTab("code")} className={tabClass(tab === "code")}>
            {t("visual.code")}
          </button>
        </div>

        {/* Buttons always mounted (only disabled) so the header never shifts */}
        <div className="flex items-center gap-1">
          <Tooltip content={t("visual.downloadSvg")} side="top">
            <button
              type="button"
              onClick={handleDownload}
              disabled={!hasVisual}
              className={iconButton}
              aria-label={t("visual.downloadSvg")}
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
          <Tooltip
            content={copied ? t("message.copied") : t("message.copyCode")}
            side="top"
            align="end"
          >
            <button
              type="button"
              onClick={handleCopy}
              className={iconButton}
              aria-label={copied ? t("message.copied") : t("message.copyCode")}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </Tooltip>
        </div>
      </div>

      {tab === "preview" ? (
        <div data-visual-preview className="flex justify-center items-center min-h-[160px] p-4 overflow-x-auto">
          {svgDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={svgDataUrl}
              alt="SVG"
              className="max-w-full max-h-[480px] object-contain animate-[fade-in_0.2s_ease-out]"
            />
          ) : mermaid.svg ? (
            <div
              className="max-w-full [&_svg]:max-w-full [&_svg]:h-auto animate-[fade-in_0.2s_ease-out]"
              dangerouslySetInnerHTML={{ __html: mermaid.svg }}
            />
          ) : mermaid.hasError ? (
            <p className="text-xs text-[var(--muted)]">{t("visual.renderFailed")}</p>
          ) : isBusy ? (
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]" aria-live="polite">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--muted)]" />
              <span>{t("chatFiles.previewLoading")}</span>
            </div>
          ) : null}
        </div>
      ) : (
        <pre className="!m-0 !border-0 !rounded-none overflow-x-auto">
          <code className="block p-4 text-[13.5px] leading-relaxed font-mono">{children}</code>
        </pre>
      )}
    </div>
  );
}
