"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";

export interface MarkdownRendererProps {
  content: string;
  className?: string;
}

interface CodeBlockProps {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}

function CodeBlock({ inline, className, children, ...props }: CodeBlockProps) {
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

export function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={cn("prose-chat", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          code: CodeBlock as any,
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
