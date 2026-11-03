"use client";

import React from "react";
import { Plus, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LegalSectionItem } from "@/lib/legal/settings";

interface LegalSectionsEditorProps {
  sections: LegalSectionItem[];
  onChange: (next: LegalSectionItem[]) => void;
}

const fieldClass =
  "w-full px-3 py-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-xs text-[var(--ink)] focus:border-[var(--accent)]";

/** Ordered list of { title, body } blocks for one legal page. */
export function LegalSectionsEditor({ sections, onChange }: LegalSectionsEditorProps) {
  function update(index: number, patch: Partial<LegalSectionItem>) {
    onChange(sections.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-3">
      {sections.map((section, idx) => (
        <div key={idx} className="p-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface)]/40 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={section.title}
              onChange={(e) => update(idx, { title: e.target.value })}
              placeholder="Judul pasal"
              className={`${fieldClass} font-semibold`}
            />
            <button
              type="button"
              onClick={() => move(idx, -1)}
              disabled={idx === 0}
              aria-label="Naikkan"
              className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)] disabled:opacity-30 cursor-pointer"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => move(idx, 1)}
              disabled={idx === sections.length - 1}
              aria-label="Turunkan"
              className="p-1.5 rounded-md text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)] disabled:opacity-30 cursor-pointer"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => onChange(sections.filter((_, i) => i !== idx))}
              aria-label="Hapus pasal"
              className="p-1.5 rounded-md text-[var(--muted)] hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <textarea
            rows={3}
            value={section.body}
            onChange={(e) => update(idx, { body: e.target.value })}
            placeholder="Isi pasal (baris kosong = paragraf baru)"
            className={`${fieldClass} leading-relaxed`}
          />
        </div>
      ))}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => onChange([...sections, { title: "", body: "" }])}
      >
        <Plus className="w-3.5 h-3.5 mr-1" />
        Tambah Pasal
      </Button>
    </div>
  );
}
