"use client";

import React from "react";
import { cssFontFamily, fontKindOf } from "@/lib/live-draft/common";
import type { InlineNode } from "@/lib/live-draft/types";

/** Blinking text cursor at the spot the AI is writing. */
export function DraftCaret() {
  return (
    <span
      aria-hidden="true"
      className="inline-block w-[0.08em] min-w-[1.5px] h-[1em] -mb-[0.12em] ml-[1px] bg-[#2563eb] animate-pulse motion-reduce:animate-none"
    />
  );
}

/** Inline rich text as React elements (never HTML strings). */
export function DraftInline({ nodes, caret = false }: { nodes: InlineNode[]; caret?: boolean }) {
  return (
    <>
      {nodes.map((node, index) => renderNode(node, index))}
      {caret ? <DraftCaret /> : null}
    </>
  );
}

function renderNode(node: InlineNode, key: number): React.ReactNode {
  if (node.kind === "text") return <React.Fragment key={key}>{node.text}</React.Fragment>;
  if (node.kind === "br") return <br key={key} />;
  const style: React.CSSProperties = {};
  if (node.bold) style.fontWeight = 700;
  if (node.italic) style.fontStyle = "italic";
  const decorations = [node.underline ? "underline" : "", node.strike ? "line-through" : ""].filter(Boolean);
  if (decorations.length) style.textDecoration = decorations.join(" ");
  if (node.color) style.color = node.color;
  if (node.background) style.backgroundColor = node.background;
  if (node.fontSize) style.fontSize = `${node.fontSize}px`;
  if (node.fontFamily) style.fontFamily = cssFontFamily(node.fontFamily, fontKindOf(node.fontFamily));
  const children = node.children.map((child, index) => renderNode(child, index));
  if (node.script) {
    const Tag = node.script === "sup" ? "sup" : "sub";
    return (
      <Tag key={key} style={style}>
        {children}
      </Tag>
    );
  }
  return (
    <span key={key} style={style}>
      {children}
    </span>
  );
}
