"use client";

import React, { useState } from "react";
import { ChevronDown, Plus, Trash2, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface CustomHeadersSectionProps {
  headers: Record<string, string>;
  defaultHeaders: Record<string, string>;
  onSave: (newHeaders: Record<string, string>) => Promise<void>;
  disabled?: boolean;
}

interface HeaderRow {
  key: string;
  value: string;
}

export function CustomHeadersSection({
  headers,
  defaultHeaders,
  onSave,
  disabled,
}: CustomHeadersSectionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [rows, setRows] = useState<HeaderRow[]>(() => {
    const list = Object.entries(headers).map(([key, value]) => ({ key, value }));
    return list.length > 0 ? list : [{ key: "", value: "" }];
  });
  const [prevHeaders, setPrevHeaders] = useState(headers);
  const [saving, setSaving] = useState(false);

  // Sync rows when the parent passes new headers, without a useEffect re-render
  if (headers !== prevHeaders) {
    setPrevHeaders(headers);
    const list = Object.entries(headers).map(([key, value]) => ({ key, value }));
    setRows(list.length > 0 ? list : [{ key: "", value: "" }]);
  }

  function handleAdd() {
    setRows((prev) => [...prev, { key: "", value: "" }]);
  }

  function handleRemove(index: number) {
    setRows((prev) => {
      const copy = [...prev];
      copy.splice(index, 1);
      return copy.length > 0 ? copy : [{ key: "", value: "" }];
    });
  }

  function handleChange(index: number, field: "key" | "value", val: string) {
    setRows((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: val };
      return copy;
    });
  }

  function handleReset() {
    const list = Object.entries(defaultHeaders).map(([key, value]) => ({ key, value }));
    setRows(list.length > 0 ? list : [{ key: "", value: "" }]);
  }

  async function handleSave() {
    const cleaned: Record<string, string> = {};
    for (const row of rows) {
      const k = row.key.trim();
      if (k) {
        cleaned[k] = row.value;
      }
    }
    setSaving(true);
    try {
      await onSave(cleaned);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-[12px] border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
      {/* Header bar styled like screenshot 3 */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full py-3.5 px-4 flex items-center justify-between text-left hover:bg-[var(--surface)] transition-colors"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
          <span className="text-[var(--muted)] font-mono text-base">☵</span>
          <span>Custom Headers</span>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-[var(--muted)] transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>

      {isOpen && (
        <div className="p-4 pt-2 border-t border-[var(--border)] space-y-3">
          <div className="space-y-2">
            {rows.map((row, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div className="w-1/3 min-w-[140px]">
                  <Input
                    placeholder="Header-Name"
                    value={row.key}
                    onChange={(e) => handleChange(idx, "key", e.target.value)}
                    disabled={disabled || saving}
                    className="text-xs font-mono"
                  />
                </div>
                <div className="flex-1">
                  <Input
                    placeholder="value"
                    value={row.value}
                    onChange={(e) => handleChange(idx, "value", e.target.value)}
                    disabled={disabled || saving}
                    className="text-xs font-mono"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(idx)}
                  disabled={disabled || saving}
                  className="p-2 text-[var(--muted)] hover:text-red-500 transition-colors rounded-[6px]"
                  title="Delete Header"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleAdd}
              disabled={disabled || saving}
              className="text-xs text-[var(--muted)] hover:text-[var(--ink)] flex items-center gap-1 font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add header</span>
            </button>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleReset}
                disabled={disabled || saving}
                className="gap-1 text-xs"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                disabled={disabled || saving}
                className="gap-1 text-xs"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? "Saving..." : "Save"}</span>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
