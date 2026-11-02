"use client";

import React from "react";
import { AtSign } from "lucide-react";

interface SourceMentionChipsProps {
  mentions: { id: string; filename: string }[];
}

/** Project sources the user @mentioned, shown above their message. */
export function SourceMentionChips({ mentions }: SourceMentionChipsProps) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5 mb-1.5 max-w-[80%]">
      {mentions.map((mention) => (
        <span
          key={mention.id}
          title={mention.filename}
          className="inline-flex items-center gap-1 max-w-[220px] px-2.5 py-1 rounded-full border border-[var(--border)] bg-[var(--panel)] text-xs font-medium text-[var(--muted)]"
        >
          <AtSign className="w-3.5 h-3.5 shrink-0 text-[var(--primary)]" />
          <span className="truncate">{mention.filename}</span>
        </span>
      ))}
    </div>
  );
}
