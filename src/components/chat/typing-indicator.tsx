"use client";

import React from "react";

export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 py-4">
      <span className="w-1.5 h-1.5 rounded-full bg-[var(--placeholder)] animate-pulse" />
      <span
        className="w-1.5 h-1.5 rounded-full bg-[var(--placeholder)] animate-pulse"
        style={{ animationDelay: "150ms" }}
      />
      <span
        className="w-1.5 h-1.5 rounded-full bg-[var(--placeholder)] animate-pulse"
        style={{ animationDelay: "300ms" }}
      />
    </div>
  );
}
