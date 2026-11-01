import React from "react";

/** Skeleton shown when chat sessions are being initially fetched from the server. */
export function SidebarSessionsSkeleton() {
  return (
    <div className="space-y-4 animate-pulse px-1" aria-busy="true">
      <div>
        <div className="h-2.5 w-12 rounded bg-[var(--hover)] mb-2" />
        <div className="space-y-1.5">
          <div className="h-7 w-full rounded-[6px] bg-[var(--hover)]" />
          <div className="h-7 w-[85%] rounded-[6px] bg-[var(--hover)]" />
          <div className="h-7 w-[70%] rounded-[6px] bg-[var(--hover)]" />
        </div>
      </div>
      <div>
        <div className="h-2.5 w-16 rounded bg-[var(--hover)] mb-2" />
        <div className="space-y-1.5">
          <div className="h-7 w-[90%] rounded-[6px] bg-[var(--hover)]" />
          <div className="h-7 w-[75%] rounded-[6px] bg-[var(--hover)]" />
        </div>
      </div>
    </div>
  );
}
