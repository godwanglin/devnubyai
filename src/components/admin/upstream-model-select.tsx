"use client";

import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { Search, ChevronDown, Check, ShieldCheck, Database, Layers } from "lucide-react";
import type { UpstreamModelOptionDto } from "@/lib/catalog-models/admin-service";

interface UpstreamModelSelectProps {
  options: UpstreamModelOptionDto[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

interface Coords {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
  openUpward: boolean;
}

export function UpstreamModelSelect({
  options,
  value,
  onChange,
  placeholder = "Pilih Model Upstream...",
  disabled = false,
}: UpstreamModelSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [coords, setCoords] = useState<Coords | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Measure and position dropdown above or below with smart clamping & portal
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 6;
    const pad = 12;

    const spaceBelow = vh - rect.bottom - gap - pad;
    const spaceAbove = rect.top - gap - pad;

    // Flip to top if not enough room below (< 240px) and more room above
    const openUpward = spaceBelow < 240 && spaceAbove > spaceBelow;

    const availableHeight = openUpward ? spaceAbove : spaceBelow;
    const maxHeight = Math.min(320, Math.max(160, availableHeight));

    let top = openUpward
      ? rect.top - maxHeight - gap
      : rect.bottom + gap;

    top = Math.max(pad, Math.min(top, vh - maxHeight - pad));

    setCoords({
      top,
      left: rect.left,
      width: Math.min(rect.width, vw - pad * 2),
      maxHeight,
      openUpward,
    });
  }, []);

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

  // Recalculate position when open or scrolled
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

  // Focus search input when open
  useEffect(() => {
    if (open) {
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Selected object
  const selected = useMemo(() => {
    return options.find((opt) => opt.id === value) ?? null;
  }, [options, value]);

  // Filtered options
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (opt) =>
        opt.modelKey.toLowerCase().includes(q) ||
        opt.gatewayName.toLowerCase().includes(q) ||
        opt.gatewaySlug.toLowerCase().includes(q) ||
        (opt.ownedBy && opt.ownedBy.toLowerCase().includes(q))
    );
  }, [options, query]);

  // Group by Gateway for clearer layout
  const groupedByGateway = useMemo(() => {
    const groups: Record<
      string,
      {
        gatewayName: string;
        gatewaySlug: string;
        isPrimary: boolean;
        items: UpstreamModelOptionDto[];
      }
    > = {};

    for (const opt of filtered) {
      if (!groups[opt.gatewayId]) {
        groups[opt.gatewayId] = {
          gatewayName: opt.gatewayName,
          gatewaySlug: opt.gatewaySlug,
          isPrimary: opt.gatewayIsPrimary,
          items: [],
        };
      }
      groups[opt.gatewayId].items.push(opt);
    }

    return Object.values(groups);
  }, [filtered]);

  return (
    <div className="relative flex-1">
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={handleToggleOpen}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-[10px] border border-[var(--border)] bg-[var(--bg)] text-xs text-left text-[var(--ink)] hover:border-[var(--accent)] transition-colors focus:border-[var(--accent)] outline-none disabled:opacity-50 cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Database className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" />
          {selected ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <code className="font-mono font-semibold text-[var(--ink)] truncate">
                {selected.modelKey}
              </code>
              <span className="text-[11px] text-[var(--muted)] shrink-0">
                via {selected.gatewayName}
              </span>
              {selected.gatewayIsPrimary && (
                <span className="flex items-center gap-0.5 px-1 py-0.2 rounded text-[9px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20 shrink-0">
                  <ShieldCheck className="w-2.5 h-2.5" /> PRIMARY
                </span>
              )}
            </div>
          ) : (
            <span className="text-[var(--placeholder)]">{placeholder}</span>
          )}
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-[var(--muted)] shrink-0 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* Render via Portal with glass token and top z-index (z-[300]) so it's always above modals */}
      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: "fixed",
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              width: `${coords.width}px`,
              maxHeight: `${coords.maxHeight}px`,
              zIndex: 300,
            }}
            className="flex flex-col rounded-[14px] border border-[var(--glass-border)] bg-[var(--panel)]/90 backdrop-blur-md shadow-2xl overflow-hidden popover-panel"
          >
            {/* Search box inside dropdown */}
            <div className="p-2 border-b border-[var(--border)] bg-[var(--panel)]/70 backdrop-blur-xs shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--muted)] pointer-events-none" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Cari model atau gateway..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--bg)]/80 text-xs text-[var(--ink)] placeholder:text-[var(--placeholder)] outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>

            {/* Options List */}
            <div className="flex-1 overflow-y-auto p-1.5 space-y-2">
              {groupedByGateway.length === 0 ? (
                <div className="py-6 text-center text-xs text-[var(--placeholder)]">
                  Tidak ada model upstream ditemukan
                </div>
              ) : (
                groupedByGateway.map((group) => (
                  <div key={group.gatewaySlug} className="space-y-1">
                    {/* Gateway Header Badge */}
                    <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-[var(--muted)] bg-[var(--hover)] rounded-[6px]">
                      <span className="flex items-center gap-1.5 truncate">
                        <Layers className="w-3 h-3 text-[var(--accent)]" />
                        {group.gatewayName} ({group.gatewaySlug})
                      </span>
                      {group.isPrimary && (
                        <span className="flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">
                          <ShieldCheck className="w-2.5 h-2.5" /> PRIMARY GATEWAY
                        </span>
                      )}
                    </div>

                    {/* Models in this Gateway */}
                    <div className="space-y-0.5 pl-1">
                      {group.items.map((opt) => {
                        const isSelected = opt.id === value;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              onChange(opt.id);
                              handleClose();
                            }}
                            className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-[8px] text-left text-xs transition-colors cursor-pointer ${
                              isSelected
                                ? "bg-[var(--accent-soft)] text-[var(--accent)] font-semibold"
                                : "text-[var(--ink)] hover:bg-[var(--hover)]"
                            }`}
                          >
                            <div className="min-w-0">
                              <code className="font-mono font-medium block truncate text-[var(--ink)]">
                                {opt.modelKey}
                              </code>
                              {opt.ownedBy && (
                                <span className="text-[10px] text-[var(--muted)]">
                                  Owned by {opt.ownedBy}
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {isSelected && <Check className="w-4 h-4 text-[var(--accent)]" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
