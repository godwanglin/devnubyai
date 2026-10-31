"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

const emptySubscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export interface PopoverProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "start" | "end" | "center";
  side?: "top" | "bottom";
  className?: string;
  triggerClassName?: string;
  openOnHover?: boolean;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface Coords {
  top: number;
  left: number;
  origin: string;
  maxHeight: number;
}

export function Popover({
  trigger,
  children,
  align = "start",
  side = "bottom",
  className,
  triggerClassName,
  openOnHover = false,
  isOpen: controlledOpen,
  onOpenChange,
}: PopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange]
  );

  const triggerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const mounted = useSyncExternalStore(
    emptySubscribe,
    getClientSnapshot,
    getServerSnapshot
  );
  const [coords, setCoords] = useState<Coords | null>(null);

  const [prevOpen, setPrevOpen] = useState(open);
  const [visible, setVisible] = useState(open);
  const [closing, setClosing] = useState(false);

  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setVisible(true);
      setClosing(false);
    } else if (visible) {
      setClosing(true);
    }
  }

  /* Keep mounted through the 110ms exit animation, then unmount. */
  useEffect(() => {
    if (closing) {
      const timer = window.setTimeout(() => {
        setVisible(false);
        setClosing(false);
        setCoords(null);
      }, 110);
      return () => window.clearTimeout(timer);
    }
  }, [closing]);

  const updatePosition = useCallback(() => {
    const triggerEl = triggerRef.current;
    const contentEl = contentRef.current;
    if (!triggerEl || !contentEl) return;

    const triggerRect = triggerEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 6;
    const pad = 8;

    const w = contentEl.offsetWidth || 240;
    const h = contentEl.offsetHeight || 200;

    // Horizontal: align to trigger, then clamp inside the viewport so the
    // panel can never be pushed off-screen (no more top-left flash).
    let left =
      align === "end"
        ? triggerRect.right - w
        : align === "center"
          ? triggerRect.left + (triggerRect.width - w) / 2
          : triggerRect.left;
    left = Math.min(Math.max(pad, left), Math.max(pad, vw - w - pad));

    const spaceBelow = vh - triggerRect.bottom - gap - pad;
    const spaceAbove = triggerRect.top - gap - pad;

    let top: number;
    let resolvedSide: "top" | "bottom";

    if (side === "top") {
      if (h <= spaceAbove || spaceAbove >= spaceBelow) {
        top = triggerRect.top - h - gap;
        resolvedSide = "top";
      } else {
        top = triggerRect.bottom + gap;
        resolvedSide = "bottom";
      }
    } else {
      if (h <= spaceBelow || spaceBelow >= spaceAbove) {
        top = triggerRect.bottom + gap;
        resolvedSide = "bottom";
      } else {
        top = triggerRect.top - h - gap;
        resolvedSide = "top";
      }
    }

    top = Math.min(Math.max(pad, top), Math.max(pad, vh - h - pad));

    const originY = resolvedSide === "top" ? "bottom" : "top";
    const originX =
      align === "end" ? "right" : align === "center" ? "center" : "left";

    // Never let the panel exceed the space it actually has.
    const maxHeight = Math.max(160, resolvedSide === "top" ? spaceAbove : spaceBelow);

    setCoords({ top, left, origin: `${originY} ${originX}`, maxHeight });
  }, [align, side]);

  /* Measure before paint so the panel never renders at 0,0. */
  useIsomorphicLayoutEffect(() => {
    if (!visible || !open) return;
    updatePosition();
  }, [visible, open, updatePosition]);

  /* Re-anchor whenever the panel resizes (e.g. quick view → catalog view).
     Without this the panel keeps its old top and grows past the viewport. */
  useEffect(() => {
    if (!visible || !open) return;
    const el = contentRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => updatePosition());
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible, open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const reposition = () => updatePosition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || contentRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, updatePosition, setOpen]);

  const handleTriggerClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(!open);
  };

  const hoverTimerRef = useRef<number | null>(null);

  const handleMouseEnter = () => {
    if (!openOnHover) return;
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    setOpen(true);
  };

  const handleMouseLeave = () => {
    if (!openOnHover) return;
    if (hoverTimerRef.current) {
      window.clearTimeout(hoverTimerRef.current);
    }
    hoverTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      hoverTimerRef.current = null;
    }, 150);
  };

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        window.clearTimeout(hoverTimerRef.current);
      }
    };
  }, []);

  return (
    <>
      <div
        ref={triggerRef}
        onClick={handleTriggerClick}
        onMouseEnter={openOnHover ? handleMouseEnter : undefined}
        onMouseLeave={openOnHover ? handleMouseLeave : undefined}
        className={cn("inline-flex", triggerClassName)}
      >
        {trigger}
      </div>

      {mounted &&
        visible &&
        createPortal(
          <div
            ref={contentRef}
            data-state={closing ? "closing" : "open"}
            onMouseEnter={openOnHover ? handleMouseEnter : undefined}
            onMouseLeave={openOnHover ? handleMouseLeave : undefined}
            style={{
              top: coords ? `${coords.top}px` : 0,
              left: coords ? `${coords.left}px` : 0,
              transformOrigin: coords?.origin,
              visibility: coords ? "visible" : "hidden",
              maxHeight: coords ? `${coords.maxHeight}px` : undefined,
              overflow: "auto",
            }}
            className={cn(
              "popover-panel fixed z-[150] glass rounded-[10px] p-1.5 min-w-[200px]",
              className
            )}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </div>,
          document.body
        )}
    </>
  );
}
