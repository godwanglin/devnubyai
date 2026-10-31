"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import {
  clearSearchHighlights,
  findTextRanges,
  paintSearchHighlights,
  scrollRectIntoView,
} from "@/lib/dom/text-search";

export interface DomTextSearchOptions {
  /** Subtree that is searched */
  rootRef: RefObject<HTMLElement | null>;
  /** Scroll container used to reveal the active match */
  scrollRef: RefObject<HTMLElement | null>;
  /** Change to re-run the search (new content rendered) */
  contentKey: unknown;
  initialQuery?: string;
}

export interface DomTextSearch {
  open: boolean;
  query: string;
  total: number;
  index: number;
  isSearching: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  setQuery: (q: string) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
}

const DEBOUNCE_MS = 140;

/**
 * Find-in-document for DOM-rendered previews: Ctrl/Cmd+F opens the bar, matches are
 * painted with the CSS Custom Highlight API (no markup mutation), Enter/Shift+Enter cycle.
 */
export function useDomTextSearch({
  rootRef,
  scrollRef,
  contentKey,
  initialQuery = "",
}: DomTextSearchOptions): DomTextSearch {
  const [open, setOpen] = useState(Boolean(initialQuery));
  const [query, setQueryState] = useState(initialQuery);
  const [total, setTotal] = useState(0);
  const [index, setIndex] = useState(-1);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rangesRef = useRef<Range[]>([]);

  const focusInput = useCallback(() => {
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 40);
  }, []);

  const reveal = useCallback(
    (idx: number) => {
      const ranges = rangesRef.current;
      paintSearchHighlights(ranges, idx);
      const range = ranges[idx];
      const scroller = scrollRef.current;
      if (!range || !scroller) return;
      scrollRectIntoView(scroller, range.getBoundingClientRect());
    },
    [scrollRef]
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
        focusInput();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusInput]);

  useEffect(() => {
    const root = rootRef.current;
    const clean = query.trim();
    if (!open || !root || !clean) {
      rangesRef.current = [];
      clearSearchHighlights();
      return;
    }
    const timer = window.setTimeout(() => {
      const ranges = findTextRanges(root, clean);
      rangesRef.current = ranges;
      setTotal(ranges.length);
      setIsSearching(false);
      const first = ranges.length ? 0 : -1;
      setIndex(first);
      if (first === -1) clearSearchHighlights();
      else reveal(first);
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, query, contentKey, rootRef, reveal]);

  useEffect(() => clearSearchHighlights, []);

  const setQuery = useCallback((q: string) => {
    setQueryState(q);
    if (q.trim()) {
      setIsSearching(true);
    } else {
      setTotal(0);
      setIndex(-1);
      setIsSearching(false);
    }
  }, []);

  const toggle = useCallback(() => {
    setOpen((was) => {
      if (was) {
        setQueryState("");
        setTotal(0);
        setIndex(-1);
        setIsSearching(false);
      } else {
        focusInput();
      }
      return !was;
    });
  }, [focusInput]);

  const step = useCallback(
    (delta: number) => {
      const count = rangesRef.current.length;
      if (count === 0) return;
      setIndex((current) => {
        const next = (current + delta + count) % count;
        reveal(next);
        return next;
      });
    },
    [reveal]
  );

  return {
    open,
    query,
    total,
    index,
    isSearching,
    inputRef,
    setQuery,
    toggle,
    next: () => step(1),
    prev: () => step(-1),
  };
}
