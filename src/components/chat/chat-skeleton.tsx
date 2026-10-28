import React from "react";

export function ChatMessagesSkeleton() {
  return (
    <div
      className="max-w-[768px] mx-auto px-4 sm:px-5 py-6 space-y-6 animate-pulse"
      aria-busy="true"
      role="status"
    >
      {/* User message skeleton (right aligned) */}
      <div className="flex flex-col items-end pl-14">
        <div className="w-[45%] h-12 rounded-[16px] rounded-br-[6px] bg-[var(--hover)]" />
      </div>

      {/* Assistant message skeleton (left aligned) */}
      <div className="space-y-3 py-2 max-w-[85%]">
        <div className="h-4 w-3/4 rounded bg-[var(--hover)]" />
        <div className="h-4 w-full rounded bg-[var(--hover)]" />
        <div className="h-4 w-5/6 rounded bg-[var(--hover)]" />
        <div className="h-4 w-1/2 rounded bg-[var(--hover)]" />
      </div>

      {/* Another User message */}
      <div className="flex flex-col items-end pl-14 pt-2">
        <div className="w-[30%] h-10 rounded-[16px] rounded-br-[6px] bg-[var(--hover)]" />
      </div>

      {/* Another Assistant message */}
      <div className="space-y-3 py-2 max-w-[85%]">
        <div className="h-4 w-4/5 rounded bg-[var(--hover)]" />
        <div className="h-4 w-full rounded bg-[var(--hover)]" />
        <div className="h-4 w-2/3 rounded bg-[var(--hover)]" />
      </div>
    </div>
  );
}
