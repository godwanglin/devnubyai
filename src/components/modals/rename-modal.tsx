"use client";

import React, { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export interface RenameModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (newValue: string) => void | Promise<void>;
  initialValue: string;
  title: string;
  description?: string;
  placeholder?: string;
  submitLabel: string;
  cancelLabel: string;
  maxLength?: number;
  loading?: boolean;
}

function RenameModalForm({
  initialValue,
  placeholder,
  submitLabel,
  cancelLabel,
  maxLength = 200,
  loading = false,
  onClose,
  onSubmit,
}: Omit<RenameModalProps, "isOpen" | "title" | "description">) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== initialValue.trim() && !loading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed || loading) return;
    if (trimmed === initialValue.trim()) {
      onClose();
      return;
    }
    await onSubmit(trimmed);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={loading}
      />
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={loading}>
          {cancelLabel}
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={!canSubmit}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function RenameModal({
  isOpen,
  onClose,
  onSubmit,
  initialValue,
  title,
  description,
  placeholder,
  submitLabel,
  cancelLabel,
  maxLength = 200,
  loading = false,
}: RenameModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!loading) onClose();
      }}
      title={title}
      description={description}
      maxWidth="sm"
    >
      <RenameModalForm
        key={initialValue}
        initialValue={initialValue}
        placeholder={placeholder}
        submitLabel={submitLabel}
        cancelLabel={cancelLabel}
        maxLength={maxLength}
        loading={loading}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </Modal>
  );
}
