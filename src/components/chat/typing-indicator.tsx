"use client";

import React from "react";
import {
  DevnubyLoaderInline,
  type DevnubyLoaderState,
} from "@/components/brand/devnuby-loader";
import { cn } from "@/lib/cn";

export interface TypingIndicatorProps {
  state?: DevnubyLoaderState;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
  labelKey?: string;
  label?: string;
  animateEnter?: boolean;
  isExiting?: boolean;
  className?: string;
}

export function TypingIndicator({
  state = "normal",
  size = "md",
  showLabel = true,
  labelKey,
  label,
  animateEnter = true,
  isExiting = false,
  className,
}: TypingIndicatorProps) {
  const resolvedLabelKey = labelKey || state;

  return (
    <div
      className={cn("flex items-center gap-2 py-3", className)}
      role="status"
      aria-live="polite"
    >
      <DevnubyLoaderInline
        state={state}
        size={size}
        showLabel={showLabel}
        labelKey={resolvedLabelKey}
        label={label}
        animateEnter={animateEnter}
        isExiting={isExiting}
      />
    </div>
  );
}
