"use client";

import React, { createContext, useContext, useState, useCallback, useMemo, useRef } from "react";
import { cn } from "@/lib/cn";

interface ToastContextType {
  toast: (message: string, durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toastText, setToastText] = useState<string | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  const toast = useCallback((message: string, durationMs = 2400) => {
    setToastText(message);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setToastText(null);
    }, durationMs);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toastText && (
        <div
          role="status"
          aria-live="polite"
          className={cn(
            "toast-panel fixed bottom-6 left-1/2 -translate-x-1/2 z-[200]",
            "max-w-[calc(100vw-32px)] w-fit text-center",
            "glass px-4 py-2.5 rounded-[10px] text-[13px] font-medium text-[var(--ink)]",
            "pointer-events-none select-none shadow-lg"
          )}
        >
          {toastText}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
