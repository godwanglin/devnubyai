"use client";

import React, { useState } from "react";
import { Download } from "lucide-react";
import {
  ImagePreviewModal,
  type PreviewImageTarget,
} from "@/components/modals/image-preview-modal";
import { Tooltip } from "@/components/ui/tooltip";
import { SmartImage } from "@/components/ui/smart-image";
import { formatFileSize, getExtensionLabel } from "@/lib/files/policy";
import { openFileInRightPanel, withCacheBuster } from "@/lib/files/preview-events";
import { useI18n } from "@/providers/i18n-provider";
import type { MessageAttachment } from "@/types";
import { renderSessionFileIcon } from "./chat-files-panel";

export interface MessageAttachmentsProps {
  attachments: MessageAttachment[];
  chatId?: string;
}

function resolveAttachmentUrl(
  url: string | undefined,
  chatId: string | undefined,
  fileId: string
): string {
  if (
    url &&
    (url.startsWith("/api/") || url.startsWith("blob:") || url.startsWith("data:"))
  ) {
    return url;
  }
  if (chatId) {
    return `/api/v1/chats/${chatId}/files/${fileId}`;
  }
  return url || "";
}

export function MessageAttachments({ attachments, chatId }: MessageAttachmentsProps) {
  const { t } = useI18n();
  const [previewImage, setPreviewImage] = useState<PreviewImageTarget | null>(null);

  if (!attachments || attachments.length === 0) return null;

  return (
    <>
      <div className="flex flex-wrap justify-end gap-2 mb-2 max-w-[80%]">
        {attachments.map((att) => {
          const fileUrl = resolveAttachmentUrl(att.url, chatId, att.id);
          const title = att.displayName || att.filename;
          const extension = getExtensionLabel(title);

          function handleOpenPanel() {
            openFileInRightPanel({
              id: att.id,
              filename: att.filename,
              displayName: title,
              extension,
              mimeType: att.mimeType,
              sizeBytes: att.sizeBytes,
              isImage: false,
              url: withCacheBuster(fileUrl),
            });
          }

          return (
            <div key={att.id} className="relative group/att">
              {att.isImage ? (
                <button
                  type="button"
                  onClick={() => setPreviewImage({ url: fileUrl, title })}
                  className="block overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--panel)] transition-transform hover:scale-[1.02] cursor-zoom-in text-left focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  aria-label={title}
                >
                  <SmartImage
                    src={fileUrl}
                    alt={title}
                    loaderSize="sm"
                    containerClassName="max-w-[260px] max-h-[220px] rounded-[12px]"
                    imgClassName="max-w-[260px] max-h-[220px] object-cover rounded-[12px]"
                    loading="lazy"
                  />
                </button>
              ) : (
                <div
                  role="button"
                  tabIndex={0}
                  onClick={handleOpenPanel}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleOpenPanel();
                    }
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--hover)] transition-colors text-xs text-[var(--ink)] cursor-pointer"
                >
                  <div className="w-7 h-7 rounded-[6px] bg-[var(--accent-soft)] border border-[var(--border)] grid place-items-center text-[var(--muted)]">
                    {renderSessionFileIcon({
                      extension,
                      isImage: false,
                      mimeType: att.mimeType,
                    })}
                  </div>
                  <div className="flex flex-col min-w-0 pr-1">
                    <span className="font-medium truncate max-w-[165px]">{title}</span>
                    <span className="text-[10px] text-[var(--muted)]">
                      {extension.toUpperCase()} · {formatFileSize(att.sizeBytes)}
                    </span>
                  </div>
                  <Tooltip content={t("chatFiles.download")} side="top" align="end">
                    <a
                      href={fileUrl}
                      download={title}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={t("chatFiles.download")}
                      className="p-1 -mr-1 rounded-[5px] text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--accent-soft)] transition-colors shrink-0 ml-1"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </a>
                  </Tooltip>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <ImagePreviewModal
        image={previewImage}
        onClose={() => setPreviewImage(null)}
      />
    </>
  );
}
