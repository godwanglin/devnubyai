import React from "react";
import { cn } from "@/lib/cn";

interface ProviderLogoProps {
  logoUrl: string | null | undefined;
  size?: "sm" | "md";
  className?: string;
}

const boxSize = { sm: "w-7 h-7 rounded-[8px]", md: "w-10 h-10 rounded-[10px]" };
const glyphSize = { sm: "w-4 h-4", md: "w-5 h-5" };

/**
 * Brand SVGs in /public/brand-logos use fill="currentColor", which an <img> renders black.
 * Painting them as a CSS mask lets the glyph follow the theme's text color.
 */
export function ProviderLogo({ logoUrl, size = "md", className }: ProviderLogoProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-center bg-[var(--surface)] border border-[var(--border)] text-[var(--ink)] shrink-0",
        boxSize[size],
        className
      )}
    >
      {logoUrl && (
        <span
          aria-hidden
          className={cn("block bg-current", glyphSize[size])}
          style={{
            maskImage: `url(${logoUrl})`,
            WebkitMaskImage: `url(${logoUrl})`,
            maskSize: "contain",
            WebkitMaskSize: "contain",
            maskRepeat: "no-repeat",
            WebkitMaskRepeat: "no-repeat",
            maskPosition: "center",
            WebkitMaskPosition: "center",
          }}
        />
      )}
    </div>
  );
}
