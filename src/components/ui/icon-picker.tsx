"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { iconNames } from "lucide-react/dynamic";
import { Popover } from "@/components/ui/popover";
import { LucideIcon } from "@/components/ui/lucide-icon";
import { loadIconTags, searchIcons } from "@/lib/icons/icon-search";
import { useI18n } from "@/providers/i18n-provider";
import { cn } from "@/lib/cn";

/** Rendering all ~2,000 icons at once is slow; the search narrows it down. */
const MAX_VISIBLE_ICONS = 120;

interface IconPickerProps {
  value: string;
  onChange: (name: string) => void;
  className?: string;
}

/** Searchable dropdown of every Lucide icon (by name or keyword), with a large preview of the hovered one. */
export function IconPicker({ value, onChange, className }: IconPickerProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hovered, setHovered] = useState<string | null>(null);
  const [tags, setTags] = useState<Record<string, string[]>>({});

  // Keyword tags are only needed once the picker is opened
  useEffect(() => {
    if (!open) return;
    let active = true;
    void loadIconTags().then((loaded) => {
      if (active) setTags(loaded);
    });
    return () => {
      active = false;
    };
  }, [open]);

  const matches = useMemo(() => searchIcons(iconNames, query, tags), [query, tags]);
  const visible = matches.slice(0, MAX_VISIBLE_ICONS);
  const previewName = hovered ?? value;

  return (
    <Popover
      isOpen={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          setHovered(null);
        }
      }}
      side="bottom"
      align="start"
      className="w-[320px] p-2"
      triggerClassName={className}
      trigger={
        <button
          type="button"
          aria-label={t("iconPicker.choose")}
          className="flex h-9 items-center gap-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--surface)] pl-2 pr-1.5 text-[var(--ink)] hover:border-[var(--primary)] transition-colors cursor-pointer"
        >
          <LucideIcon name={value} className="h-4 w-4" />
          <ChevronDown className="h-3.5 w-3.5 text-[var(--muted)]" />
        </button>
      }
    >
      {/* Preview of the hovered icon (or the current one) */}
      <div className="flex items-center gap-3 rounded-[8px] border border-[var(--glass-border)] p-2">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] bg-[var(--hover)] text-[var(--ink)]">
          <LucideIcon name={previewName} className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-[var(--ink)]">{previewName}</p>
          <p className="text-[11px] text-[var(--muted)]">
            {t("iconPicker.count", { count: matches.length.toLocaleString() })}
          </p>
        </div>
      </div>

      <div className="relative mt-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("iconPicker.search")}
          className="h-8 w-full rounded-[8px] border border-[var(--input-border)] bg-[var(--input-bg)] pl-8 pr-2.5 text-xs text-[var(--ink)] placeholder:text-[var(--placeholder)] outline-none focus:border-[var(--accent)]/60"
        />
      </div>

      {visible.length === 0 ? (
        <p className="py-6 text-center text-xs text-[var(--muted)]">{t("iconPicker.noMatch")}</p>
      ) : (
        <div
          role="listbox"
          aria-label={t("iconPicker.choose")}
          className="mt-2 grid max-h-[220px] grid-cols-8 gap-1 overflow-y-auto pr-0.5"
          onMouseLeave={() => setHovered(null)}
        >
          {visible.map((name) => (
            <button
              key={name}
              type="button"
              role="option"
              aria-selected={name === value}
              title={name}
              onMouseEnter={() => setHovered(name)}
              onFocus={() => setHovered(name)}
              onClick={() => {
                onChange(name);
                setOpen(false);
                setQuery("");
                setHovered(null);
              }}
              className={cn(
                "glass-hover grid aspect-square place-items-center rounded-[6px] text-[var(--ink)] cursor-pointer",
                name === value && "bg-[var(--hover)] ring-1 ring-[var(--accent)]/60"
              )}
            >
              <LucideIcon name={name} className="h-4 w-4" />
            </button>
          ))}
        </div>
      )}

      {matches.length > visible.length ? (
        <p className="mt-1.5 text-center text-[10px] text-[var(--placeholder)]">
          {t("iconPicker.refine", { count: (matches.length - visible.length).toLocaleString() })}
        </p>
      ) : null}
    </Popover>
  );
}
