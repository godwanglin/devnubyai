"use client";

import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { Download, ExternalLink, X } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";
import { SmartImage } from "@/components/ui/smart-image";
import { useI18n } from "@/providers/i18n-provider";

export interface PreviewImageTarget {
  url: string;
  title: string;
}

export interface ImagePreviewModalProps {
  image: PreviewImageTarget | null;
  onClose: () => void;
}

export function ImagePreviewModal({ image, onClose }: ImagePreviewModalProps) {
  const { t } = useI18n();

  useEffect(() => {
    if (!image) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [image, onClose]);

  if (!image || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.title}
      className="fixed inset-0 z-[145] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      {/* Top Bar with title and actions */}
      <div className="absolute top-4 inset-x-4 flex items-center justify-between pointer-events-none">
        <span className="text-xs text-white/80 font-medium truncate max-w-[50%] bg-black/40 px-3 py-1.5 rounded-full border border-white/10 backdrop-blur-md">
          {image.title}
        </span>

        <div className="flex items-center gap-2 pointer-events-auto">
          <Tooltip content={t("chatFiles.download")} side="bottom">
            <a
              href={image.url}
              download={image.title}
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center transition-colors border border-white/10 cursor-pointer"
              aria-label={t("chatFiles.download")}
              onClick={(e) => e.stopPropagation()}
            >
              <Download className="w-4 h-4" />
            </a>
          </Tooltip>

          <Tooltip content={t("shareModal.openLink")} side="bottom">
            <a
              href={image.url}
              target="_blank"
              rel="noopener noreferrer"
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center transition-colors border border-white/10 cursor-pointer"
              aria-label={t("shareModal.openLink")}
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </Tooltip>

          <Tooltip content={t("chatFiles.close")} side="bottom" align="end">
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white grid place-items-center transition-colors border border-white/10 cursor-pointer"
              aria-label={t("chatFiles.close")}
            >
              <X className="w-4 h-4" />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Modal Image container */}
      <div
        className="relative max-w-full max-h-full flex items-center justify-center p-2"
        onClick={(e) => e.stopPropagation()}
      >
        <SmartImage
          src={image.url}
          alt={image.title}
          loaderSize="lg"
          showLabel
          labelText={t("loader.loading") !== "loader.loading" ? t("loader.loading") : "Memuat gambar..."}
          containerClassName="max-w-[90vw] max-h-[85vh] rounded-[12px] min-w-[280px] min-h-[220px]"
          imgClassName="max-w-[90vw] max-h-[85vh] object-contain rounded-[12px] shadow-2xl border border-white/10"
        />
      </div>
    </div>,
    document.body
  );
}
