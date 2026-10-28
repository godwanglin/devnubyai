"use client";

import React, { forwardRef } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "outline" | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon" | "icon-sm";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const base =
  "inline-flex items-center justify-center gap-2 font-medium select-none cursor-pointer transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--accent-text)] hover:bg-[var(--accent-hover)] active:scale-[0.985]",
  secondary:
    "bg-[var(--panel-elevated)] text-[var(--ink)] border border-[var(--border)] hover:bg-[var(--hover)]",
  ghost: "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]",
  outline:
    "border border-[var(--border)] text-[var(--ink)] hover:border-[var(--placeholder)] hover:bg-[var(--hover)]",
  danger: "text-red-500 hover:bg-red-500/10",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 rounded-[var(--radius-sm)] text-[13px]",
  md: "h-10 px-4 rounded-[var(--radius-md)] text-sm",
  lg: "h-11 px-5 rounded-[var(--radius-md)] text-sm",
  icon: "h-9 w-9 rounded-[var(--radius-md)]",
  "icon-sm": "h-7 w-7 rounded-[var(--radius-sm)]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "ghost", size = "md", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  )
);

Button.displayName = "Button";
