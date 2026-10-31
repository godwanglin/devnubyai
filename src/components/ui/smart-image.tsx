"use client";

import React, { useEffect, useRef, useState } from "react";
import { ImageOff } from "lucide-react";
import { DevnubyLoaderMascot } from "@/components/brand/devnuby-loader";
import { cn } from "@/lib/cn";

// 5 minutes in-memory cache TTL for loaded images
const IMAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const memoryImageCache = new Map<string, number>();

/**
 * Checks whether an image URL was successfully loaded and is still valid in cache.
 */
export function isImageCached(src?: string): boolean {
  if (!src) return false;
  const expiresAt = memoryImageCache.get(src);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    memoryImageCache.delete(src);
    return false;
  }
  return true;
}

/**
 * Marks an image URL as cached for 5 minutes.
 */
export function markImageCached(src?: string): void {
  if (!src) return;
  memoryImageCache.set(src, Date.now() + IMAGE_CACHE_TTL_MS);
}

export interface SmartImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt?: string;
  loaderSize?: "sm" | "md" | "lg";
  showLabel?: boolean;
  labelText?: string;
  errorMessage?: string;
  containerClassName?: string;
  imgClassName?: string;
  loaderClassName?: string;
}

const SIZE_CONFIGS = {
  sm: {
    mascot: "w-9 h-9",
    shadow: "w-7 h-1.5 -mt-1",
    text: "text-[10px]",
    defaultMinH: "min-h-[72px]",
  },
  md: {
    mascot: "w-13 h-13",
    shadow: "w-10 h-2 -mt-2",
    text: "text-xs",
    defaultMinH: "min-h-[140px]",
  },
  lg: {
    mascot: "w-20 h-20",
    shadow: "w-14 h-2.5 -mt-3",
    text: "text-xs sm:text-sm",
    defaultMinH: "min-h-[220px]",
  },
};

/**
 * SmartImage: Renders images with DevNuby mascot normal loading animation,
 * 5-minute memory caching, smooth fade-in, and error fallback state.
 */
export function SmartImage({
  src,
  alt = "",
  loaderSize = "md",
  showLabel = false,
  labelText = "Memuat gambar...",
  errorMessage = "Gagal memuat gambar",
  containerClassName,
  imgClassName,
  loaderClassName,
  className,
  loading = "lazy",
  onLoad,
  onError,
  ...restProps
}: SmartImageProps) {
  const [isLoading, setIsLoading] = useState<boolean>(() => !isImageCached(src));
  const [hasError, setHasError] = useState<boolean>(false);
  const [prevSrc, setPrevSrc] = useState<string>(src);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const cfg = SIZE_CONFIGS[loaderSize] || SIZE_CONFIGS.md;

  if (prevSrc !== src) {
    setPrevSrc(src);
    setIsLoading(!isImageCached(src));
    setHasError(false);
  }

  useEffect(() => {
    if (!src) return;

    // Check if the image element is already complete in the browser (e.g. disk cache)
    if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      markImageCached(src);
      const timer = setTimeout(() => {
        setIsLoading(false);
        setHasError(false);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [src]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    if (src) markImageCached(src);
    setIsLoading(false);
    setHasError(false);
    onLoad?.(e);
  };

  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
    setIsLoading(false);
    setHasError(true);
    onError?.(e);
  };

  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden transition-all",
        isLoading && cfg.defaultMinH,
        isLoading && "bg-[#090E1A]/60 border border-white/5",
        containerClassName,
        className
      )}
      aria-busy={isLoading}
    >
      {/* DevNuby Mascot Loading Stage */}
      {isLoading && (
        <div
          className={cn(
            "absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 p-3 select-none pointer-events-none transition-opacity duration-300",
            loaderClassName
          )}
        >
          <div className={cn(cfg.mascot, "relative flex items-center justify-center overflow-visible")}>
            <DevnubyLoaderMascot state="normal" interactive className="w-full h-full overflow-visible" />
          </div>
          <div className={cn("dn-loader-shadow rounded-full bg-cyan-400/30 blur-[2px]", cfg.shadow)} />
          {showLabel && (
            <span className={cn("font-medium tracking-tight text-slate-300/80 mt-1 animate-pulse", cfg.text)}>
              {labelText}
            </span>
          )}
        </div>
      )}

      {/* Error Fallback */}
      {hasError && (
        <div className="flex flex-col items-center justify-center gap-2 p-4 text-[var(--muted)] text-center min-h-[100px] w-full">
          <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10 grid place-items-center text-slate-400">
            <ImageOff className="w-4 h-4" />
          </div>
          <span className="text-xs font-medium text-slate-300">{errorMessage}</span>
          {alt && <span className="text-[10px] text-slate-500 truncate max-w-[200px]">{alt}</span>}
        </div>
      )}

      {/* Main Image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        loading={loading}
        onLoad={handleImageLoad}
        onError={handleImageError}
        className={cn(
          "transition-opacity duration-300 ease-out",
          isLoading ? "opacity-0" : "opacity-100",
          hasError && "hidden",
          imgClassName
        )}
        {...restProps}
      />
    </div>
  );
}
