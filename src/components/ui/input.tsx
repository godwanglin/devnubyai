"use client";

import React, { forwardRef } from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  hasError?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, hasError, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "w-full h-10 px-3.5 rounded-[var(--radius-md)] border bg-[var(--input-bg)] backdrop-blur-xs text-sm text-[var(--ink)] placeholder:text-[var(--muted)]/70 transition-[background-color,border-color] duration-150 focus:bg-[var(--input-bg-focus)]",
        hasError
          ? "border-red-500/60 focus:border-red-500"
          : "border-[var(--input-border)] focus:border-[var(--accent)]/60",
        "disabled:opacity-50 disabled:pointer-events-none",
        className
      )}
      {...props}
    />
  )
);

Input.displayName = "Input";
