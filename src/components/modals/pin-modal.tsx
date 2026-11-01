"use client";

import React, { useEffect, useRef, useState } from "react";
import { Lock, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { cn } from "@/lib/cn";

export interface PinModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode?: "create" | "verify";
  onSuccess: (pin: string) => void;
}

export function PinModal({
  isOpen,
  onClose,
  mode = "create",
  onSuccess,
}: PinModalProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [pin, setPin] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isShaking, setIsShaking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  async function handlePinComplete(enteredPin: string) {
    setIsSubmitting(true);
    try {
      if (mode === "create") {
        const res = await fetch("/api/v1/user/pin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: enteredPin }),
          credentials: "same-origin",
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error?.message || "Gagal membuat PIN");
        }
        toast(t("lockChat.pinCreatedSuccess"));
        onSuccess(enteredPin);
        onClose();
      } else {
        const res = await fetch("/api/v1/user/pin", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: enteredPin }),
          credentials: "same-origin",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.data?.valid) {
          throw new Error(t("lockChat.pinIncorrect"));
        }
        onSuccess(enteredPin);
        onClose();
      }
    } catch (err: unknown) {
      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 500);
      setPin("");
      toast(err instanceof Error ? err.message : t("toast.actionFailed"));
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value.replace(/\D/g, "").slice(0, 4);
    setPin(val);
    if (val.length === 4) {
      void handlePinComplete(val);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (!isSubmitting) onClose();
      }}
      maxWidth="sm"
    >
      <div className="flex flex-col items-center text-center space-y-4 pt-2 pb-2">
        {/* Circular Lock Badge (Gambar 2) */}
        <div className="grid place-items-center w-14 h-14 rounded-full bg-black/80 border border-[var(--border)] text-white shadow-md">
          <Lock className="w-6 h-6 stroke-[2]" />
        </div>

        {/* Title */}
        <h2 className="text-lg font-bold text-[var(--ink)]">
          {mode === "create" ? t("lockChat.createPinTitle") : t("lockChat.enterPinTitle")}
        </h2>

        {/* Description Body */}
        <p className="text-xs text-[var(--muted)] leading-relaxed max-w-sm px-2">
          {t("lockChat.pinBody")}
        </p>

        {/* Hidden Input for Mobile & Desktop Keypad */}
        <input
          ref={inputRef}
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={4}
          value={pin}
          onChange={handleInputChange}
          disabled={isSubmitting}
          className="sr-only opacity-0 absolute pointer-events-none"
          autoComplete="one-time-code"
        />

        {/* 4-digit Pill Inputs */}
        <div
          onClick={() => inputRef.current?.focus()}
          className={cn(
            "flex items-center justify-center gap-3 py-4 cursor-pointer select-none",
            isShaking && "animate-shake"
          )}
        >
          {[0, 1, 2, 3].map((idx) => {
            const isFilled = pin.length > idx;
            const isCurrent = pin.length === idx;

            return (
              <div
                key={idx}
                className={cn(
                  "grid place-items-center w-11 h-16 rounded-full border transition-all text-sm font-semibold select-none",
                  isCurrent
                    ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/30 bg-[var(--panel-elevated)]"
                    : "border-[var(--border)] bg-black/40 hover:bg-black/60",
                  isFilled ? "text-[var(--ink)]" : "text-[var(--placeholder)]"
                )}
              >
                {isFilled ? (
                  <span className="text-lg font-bold">●</span>
                ) : isCurrent ? (
                  <span className="animate-pulse text-base font-normal text-[var(--accent)]">
                    |
                  </span>
                ) : (
                  <span className="text-xs text-[var(--placeholder)]">-</span>
                )}
              </div>
            );
          })}
        </div>

        {isSubmitting && (
          <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Memverifikasi...</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
