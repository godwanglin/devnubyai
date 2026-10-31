"use client";

import React, { useEffect, useRef } from "react";
import { THUMB_WIDTH } from "./document-thumbnails-sidebar";

export interface DomPageThumbnailProps {
  /** Rendered page element to mirror */
  source: HTMLElement;
  /** Class of the page's original parent, so its scoped CSS still applies to the clone */
  wrapperClassName?: string;
}

/** Thumbnail made from a scaled, inert clone of an already rendered DOM page. */
export function DomPageThumbnail({ source, wrapperClassName }: DomPageThumbnailProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const width = source.offsetWidth || 1;

    const clone = source.cloneNode(true) as HTMLElement;
    clone.removeAttribute("id");
    clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    clone.style.margin = "0";
    clone.style.boxShadow = "none";

    const wrap = document.createElement("div");
    if (wrapperClassName) wrap.className = wrapperClassName;
    wrap.setAttribute("inert", "");
    Object.assign(wrap.style, {
      width: `${width}px`,
      padding: "0",
      background: "transparent",
      transform: `scale(${THUMB_WIDTH / width})`,
      transformOrigin: "0 0",
      pointerEvents: "none",
    });
    wrap.appendChild(clone);
    host.replaceChildren(wrap);
    return () => host.replaceChildren();
  }, [source, wrapperClassName]);

  return <div ref={hostRef} aria-hidden="true" className="absolute inset-0 overflow-hidden" />;
}
