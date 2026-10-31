"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export interface ScrollPagesOptions {
  scrollRef: RefObject<HTMLElement | null>;
  /** Page elements in document order, inside the scroll container */
  getPages: () => HTMLElement[];
  /** Change to re-read the page list (e.g. after rendering or zoom) */
  contentKey: unknown;
}

export interface ScrollPages {
  pageCount: number;
  currentPage: number;
  jumpToPage: (page: number) => void;
  /** 1-based page containing the node, or null */
  pageOf: (node: Node) => number | null;
}

const ACTIVE_LINE = 0.35;
const JUMP_LOCK_MS = 450;

/** Tracks which page is in view while scrolling a continuous page stack, and jumps between pages. */
export function useScrollPages({ scrollRef, getPages, contentKey }: ScrollPagesOptions): ScrollPages {
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const pagesRef = useRef<HTMLElement[]>([]);
  const getPagesRef = useRef(getPages);
  const jumpingRef = useRef(false);

  useEffect(() => {
    getPagesRef.current = getPages;
  }, [getPages]);

  useEffect(() => {
    pagesRef.current = getPagesRef.current();
    setPageCount(pagesRef.current.length);
    setCurrentPage((p) => Math.min(Math.max(p, 1), Math.max(pagesRef.current.length, 1)));
  }, [contentKey]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (jumpingRef.current) return;
      const pages = pagesRef.current;
      if (pages.length === 0) return;
      const line = scroller.getBoundingClientRect().top + scroller.clientHeight * ACTIVE_LINE;
      let best = 1;
      for (let i = 0; i < pages.length; i++) {
        if (pages[i].getBoundingClientRect().top <= line) best = i + 1;
        else break;
      }
      setCurrentPage(best);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [scrollRef, contentKey]);

  const jumpToPage = useCallback(
    (page: number) => {
      const scroller = scrollRef.current;
      const pages = pagesRef.current;
      if (!scroller || pages.length === 0) return;
      const target = Math.min(Math.max(page, 1), pages.length);
      const offset = pages[target - 1].getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      setCurrentPage(target);
      jumpingRef.current = true;
      scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + offset - 12), behavior: "smooth" });
      window.setTimeout(() => {
        jumpingRef.current = false;
      }, JUMP_LOCK_MS);
    },
    [scrollRef]
  );

  const pageOf = useCallback((node: Node) => {
    const idx = pagesRef.current.findIndex((p) => p.contains(node));
    return idx === -1 ? null : idx + 1;
  }, []);

  return { pageCount, currentPage, jumpToPage, pageOf };
}
