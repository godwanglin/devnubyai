"use client";

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Search, ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/cn";

export interface CustomSelectOption<T extends string = string> {
  value: T;
  label: string;
  sublabel?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
}

export interface CustomSelectProps<T extends string = string> {
  options: CustomSelectOption<T>[];
  value: T;
  onChange: (val: T) => void;
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
  className?: string;
  size?: "sm" | "md";
  variant?: "default" | "inline";
  align?: "left" | "right";
  zIndex?: number;
}

interface Coords {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  openUpward: boolean;
}

export function CustomSelect<T extends string = string>({
  options,
  value,
  onChange,
  placeholder = "Pilih...",
  searchable = false,
  disabled = false,
  className,
  size = "sm",
  variant = "default",
  align = "left",
  zIndex = 10001,
}: CustomSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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

  // Keep mounted during the 110ms exit animation
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

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 4;
    const pad = 12;

    const spaceBelow = vh - rect.bottom - gap - pad;
    const spaceAbove = rect.top - gap - pad;

    // Flip to top if not enough room below (< 180px) and more room above
    const openUpward = spaceBelow < 180 && spaceAbove > spaceBelow;

    const availableHeight = openUpward ? spaceAbove : spaceBelow;
    const maxHeight = Math.min(260, Math.max(140, availableHeight));

    let top = openUpward
      ? rect.top - maxHeight - gap
      : rect.bottom + gap;

    top = Math.max(pad, Math.min(top, vh - maxHeight - pad));

    const minWidth = variant === "inline" ? 180 : rect.width;
    const targetWidth = Math.max(minWidth, rect.width);
    const finalWidth = Math.min(targetWidth, vw - pad * 2);

    let left = rect.left;
    if (align === "right" || variant === "inline") {
      left = rect.right - finalWidth;
    }
    left = Math.max(pad, Math.min(left, vw - finalWidth - pad));

    setCoords({
      top,
      left,
      width: finalWidth,
      maxHeight,
      openUpward,
    });
  }, [variant, align]);

  function handleToggleOpen() {
    setOpen((prev) => {
      const next = !prev;
      if (!next) setQuery("");
      return next;
    });
  }

  function handleClose() {
    setOpen(false);
    setQuery("");
  }

  // Reposition on scroll or resize
  useEffect(() => {
    if (!open) return;
    updatePosition();

    function handleScrollOrResize() {
      updatePosition();
    }

    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
    };
  }, [open, updatePosition]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        handleClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  // Focus search when open
  useEffect(() => {
    if (open && searchable) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open, searchable]);

  const selected = useMemo(() => {
    return options.find((opt) => opt.value === value) ?? null;
  }, [options, value]);

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        (opt.sublabel && opt.sublabel.toLowerCase().includes(q))
    );
  }, [options, query, searchable]);

  return (
    <div
      ref={containerRef}
      className={cn(variant === "inline" ? "relative inline-block" : "relative w-full", className)}
    >
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleToggleOpen}
        className={cn(
          variant === "inline"
            ? "inline-flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--ink)] transition-colors cursor-pointer outline-none bg-transparent p-0 select-none group"
            : cn(
                "w-full flex items-center justify-between gap-2 rounded-[8px] border border-[var(--border)] bg-[var(--bg)] text-left text-[var(--ink)] hover:border-[var(--accent)] transition-colors focus:border-[var(--accent)] outline-none disabled:opacity-50 cursor-pointer",
                size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3 py-2 text-sm"
              )
        )}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {selected?.icon && <span className="shrink-0">{selected.icon}</span>}
          {selected ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <span className={cn("truncate", variant === "inline" ? "font-normal" : "font-medium text-[var(--ink)]")}>
                {selected.label}
              </span>
              {selected.sublabel && (
                <span className="text-[11px] text-[var(--muted)] shrink-0">
                  {selected.sublabel}
                </span>
              )}
              {selected.badge && <span className="shrink-0">{selected.badge}</span>}
            </div>
          ) : (
            <span className="text-[var(--placeholder)]">{placeholder}</span>
          )}
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[var(--muted)] group-hover:text-[var(--ink)] shrink-0 transition-all duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Dropdown Menu via Portal with glass & popover-panel token */}
      {visible &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dropdownRef}
            data-state={closing ? "closing" : "open"}
            style={{
              position: "fixed",
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              width: `${coords.width}px`,
              maxHeight: `${coords.maxHeight}px`,
              zIndex,
            }}
            className="popover-panel glass flex flex-col rounded-[12px] shadow-2xl overflow-hidden"
          >
            {searchable && (
              <div className="p-2 border-b border-[var(--glass-border)] bg-[var(--panel)]/70 backdrop-blur-xs shrink-0">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted)] pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Cari..."
                    className="w-full pl-8 pr-3 py-1.5 rounded-[8px] border border-[var(--glass-border)] bg-[var(--bg)]/80 text-xs text-[var(--ink)] placeholder:text-[var(--placeholder)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-1 space-y-0.5 [scrollbar-width:thin]">
              {filtered.length === 0 ? (
                <div className="py-4 text-center text-xs text-[var(--placeholder)]">
                  Tidak ada pilihan
                </div>
              ) : (
                filtered.map((opt) => {
                  const isSelected = opt.value === value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      data-highlighted={isSelected ? "true" : undefined}
                      onClick={() => {
                        onChange(opt.value);
                        handleClose();
                      }}
                      className={cn(
                        "glass-hover w-full flex items-center justify-between gap-2 px-3 py-2 rounded-[8px] text-left text-xs transition-colors cursor-pointer",
                        isSelected
                          ? "text-[var(--ink)] font-semibold"
                          : "text-[var(--ink)]"
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {opt.icon && <span className="shrink-0">{opt.icon}</span>}
                        <span className="truncate">{opt.label}</span>
                        {opt.sublabel && (
                          <span className="text-[10px] text-[var(--muted)] shrink-0">
                            {opt.sublabel}
                          </span>
                        )}
                        {opt.badge && <span className="shrink-0">{opt.badge}</span>}
                      </div>
                      {isSelected && <Check className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
