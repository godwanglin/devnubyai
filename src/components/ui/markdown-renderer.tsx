"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";
import { CitationBadge } from "@/components/chat/citation-badge";
import { SmartImage } from "./smart-image";
import { Button } from "./button";
import { isTrustedImageSrc } from "@/lib/files/policy";
import { VisualBlock, getVisualKind } from "./visual-block";
import type { CompactWebSource } from "@/lib/tools/compact-source";

export interface MarkdownRendererProps {
  content: string;
  className?: string;
  sourcesMap?: Map<string, CompactWebSource>;
}

interface CodeBlockProps {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
  openFenceCode?: string | null;
}

function CodeBlock({ inline, className, children, openFenceCode, ...props }: CodeBlockProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);

  // Match language class (e.g., "language-python", "language-typescript")
  const match = /language-(\w+)/.exec(className || "");
  const language = match ? match[1] : "";

  // Extract raw text for copying
  const rawCode = extractText(children).replace(/\n$/, "");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(rawCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  // Inline code (e.g. `const x = 1`)
  if (inline || (!match && !rawCode.includes("\n"))) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  }

  // SVG & Mermaid blocks render as a visual with a Preview / Code toggle
  const visualKind = getVisualKind(language, rawCode);
  if (visualKind) {
    return (
      <VisualBlock
        kind={visualKind}
        code={rawCode}
        isStreaming={openFenceCode != null && openFenceCode.trimEnd() === rawCode.trimEnd()}
      >
        {children}
      </VisualBlock>
    );
  }

  // Preformatted multiline code block with professional header & copy action
  return (
    <div className="group relative my-4 rounded-[10px] border border-[var(--border)] bg-[#0a0a0a] overflow-hidden">
      {/* Code block header bar */}
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-[var(--border)] bg-[#111111]/80 backdrop-blur-xs select-none">
        <span className="text-[12px] font-mono font-medium text-[var(--muted)] lowercase">
          {language || "text"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-[6px] text-[11.5px] font-medium text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)] transition-colors cursor-pointer"
          aria-label={copied ? t("message.copied") : t("message.copyCode")}
        >
          {copied ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-emerald-400">{t("message.copied")}</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>{t("message.copyCode")}</span>
            </>
          )}
        </button>
      </div>

      {/* Code body */}
      <pre className="!m-0 !p-0 !border-0 !rounded-none !bg-transparent overflow-x-auto">
        <code className={cn("block p-4 text-[13.5px] leading-relaxed font-mono", className)} {...props}>
          {children}
        </code>
      </pre>
    </div>
  );
}

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode };
    return extractText(props.children);
  }
  return "";
}

/**
 * Many models emit LaTeX as \( … \) / \[ … \]; remark-math only understands
 * $ … $ / $$ … $$, so normalize the delimiters (code spans/blocks untouched).
 */
function normalizeMath(markdown: string): string {
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((chunk, i) =>
      i % 2 === 1
        ? chunk
        : chunk
            .replace(/\\\[([\s\S]+?)\\\]/g, (_, expr) => `\n$$\n${expr.trim()}\n$$\n`)
            .replace(/\\\(([\s\S]+?)\\\)/g, (_, expr) => `$${expr.trim()}$`)
    )
    .join("");
}

/**
 * Returns the body of a trailing fenced block that hasn't been closed yet
 * (the model is still streaming it), or null when every fence is closed.
 */
function getOpenFenceCode(markdown: string): string | null {
  const fences = markdown.match(/^ {0,3}```/gm);
  if (!fences || fences.length % 2 === 0) return null;
  const lastFence = markdown.lastIndexOf("```");
  const afterLang = markdown.indexOf("\n", lastFence);
  if (afterLang === -1) return "";
  return markdown.slice(afterLang + 1).replace(/\n$/, "");
}

const MarkdownContext = React.createContext<{
  sourcesMap?: Map<string, CompactWebSource>;
  openFenceCode: string | null;
}>({ openFenceCode: null });

function MarkdownCode(props: CodeBlockProps) {
  const { openFenceCode } = React.useContext(MarkdownContext);
  return <CodeBlock {...props} openFenceCode={openFenceCode} />;
}

function MarkdownLink({ href, children }: { href?: string; children?: React.ReactNode }) {
  const { sourcesMap } = React.useContext(MarkdownContext);
  if (!href) return <>{children}</>;
  return (
    <CitationBadge href={href} sourcesMap={sourcesMap}>
      {children}
    </CitationBadge>
  );
}

function MarkdownPre({ children }: { children?: React.ReactNode }) {
  return <>{children}</>;
}

function MarkdownTable({ children }: { children?: React.ReactNode }) {
  return (
    <div className="my-4 w-full max-w-full overflow-x-auto rounded-[10px] border border-[var(--border)]">
      <table className="!m-0 w-max min-w-full border-collapse [&_th:first-child]:border-l-0 [&_td:first-child]:border-l-0 [&_th:last-child]:border-r-0 [&_td:last-child]:border-r-0 [&_thead_tr:first-child_th]:border-t-0 [&_tbody_tr:last-child_td]:border-b-0">
        {children}
      </table>
    </div>
  );
}

function MarkdownImage(props: React.ComponentPropsWithoutRef<"img">) {
  const { t } = useI18n();
  const [allowExternal, setAllowExternal] = useState(false);
  const src = typeof props.src === "string" ? props.src : "";
  if (!src) return null;

  // External images load only on request: rendering them would ping (and leak data to) their host
  if (!allowExternal && !isTrustedImageSrc(src)) {
    let host = src;
    try {
      host = new URL(src).host;
    } catch {
      // keep the raw value
    }
    return (
      <span className="my-3 flex max-w-2xl items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2 text-xs text-[var(--muted)]">
        <span className="min-w-0 truncate">
          {t("message.externalImage")} · {host}
        </span>
        <Button variant="outline" size="sm" onClick={() => setAllowExternal(true)}>
          {t("message.loadImage")}
        </Button>
      </span>
    );
  }

  return (
    <span className="block my-3">
      <SmartImage
        src={src}
        alt={props.alt || "Image"}
        loaderSize="md"
        showLabel
        containerClassName="max-w-2xl rounded-xl border border-[var(--border)] overflow-hidden"
        imgClassName="w-full h-auto max-h-[500px] object-contain rounded-xl"
      />
    </span>
  );
}

// Module-level so component identity is stable: inline components would remount
// every block (and reset visual previews) on each streamed token
const MARKDOWN_COMPONENTS = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  code: MarkdownCode as any,
  pre: MarkdownPre,
  table: MarkdownTable,
  a: MarkdownLink,
  img: MarkdownImage,
};
const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [
  rehypeHighlight,
  [rehypeKatex, { throwOnError: false, strict: "ignore" }],
] as React.ComponentProps<typeof ReactMarkdown>["rehypePlugins"];

export function MarkdownRenderer({ content, className, sourcesMap }: MarkdownRendererProps) {
  const normalized = normalizeMath(content);
  const openFenceCode = getOpenFenceCode(normalized);
  const ctx = React.useMemo(() => ({ sourcesMap, openFenceCode }), [sourcesMap, openFenceCode]);

  return (
    <div className={cn("prose-chat min-w-0 max-w-full", className)}>
      <MarkdownContext.Provider value={ctx}>
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={MARKDOWN_COMPONENTS}
        >
          {normalized}
        </ReactMarkdown>
      </MarkdownContext.Provider>
    </div>
  );
}
