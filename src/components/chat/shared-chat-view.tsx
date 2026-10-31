"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Link2Off, Moon, Sparkles, Sun } from "lucide-react";
import { DevnubyIcon, DevnubyWordmark } from "@/components/brand/devnuby-logo";
import { Tooltip } from "@/components/ui/tooltip";
import {
  mapApiMessagesToUIMessages,
  mapUIMessagesToDomain,
  type ApiMessageItem,
} from "@/lib/chat/client-mappers";
import type { SharedChatDto } from "@/lib/chat/share";
import { OPEN_FILE_PREVIEW_EVENT, withCacheBuster } from "@/lib/files/preview-events";
import { useI18n } from "@/providers/i18n-provider";
import { useTheme } from "@/providers/theme-provider";
import type { SessionFileItem } from "@/types";
import { ChatFilesPanel } from "./chat-files-panel";
import { MessageList } from "./message-list";

export interface SharedChatViewProps {
  sharedChat: SharedChatDto | null;
}

export function SharedChatView({ sharedChat }: SharedChatViewProps) {
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();
  const [previewFile, setPreviewFile] = useState<SessionFileItem | null>(null);
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);

  useEffect(() => {
    const onOpenPreview = (e: Event) => {
      const detail = (e as CustomEvent<SessionFileItem>).detail;
      if (detail) {
        const freshUrl = detail.url ? withCacheBuster(detail.url) : detail.url;
        setPreviewFile({ ...detail, url: freshUrl });
      }
    };
    window.addEventListener(OPEN_FILE_PREVIEW_EVENT, onOpenPreview);
    return () => window.removeEventListener(OPEN_FILE_PREVIEW_EVENT, onOpenPreview);
  }, []);

  const domainMessages = useMemo(() => {
    if (!sharedChat) return [];
    const uiMessages = mapApiMessagesToUIMessages(
      sharedChat.messages as unknown as ApiMessageItem[]
    );
    return mapUIMessagesToDomain(uiMessages);
  }, [sharedChat]);

  const hideChatForFullscreen = Boolean(previewFile) && isPreviewFullscreen;

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[var(--surface)] text-[var(--ink)]">
      <div
        className={
          hideChatForFullscreen
            ? "hidden"
            : "flex flex-col flex-1 min-w-0 h-full overflow-hidden"
        }
      >
        <header className="flex items-center justify-between gap-3 h-14 px-4 sm:px-6 border-b border-[var(--border)] bg-[var(--panel)] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/" className="inline-flex items-center shrink-0" aria-label={t("brand.name")}>
              <DevnubyIcon className="w-8 h-8 sm:hidden" />
              <DevnubyWordmark className="hidden sm:block h-8 w-auto" />
            </Link>

            {sharedChat ? (
              <>
                <span className="text-[var(--border)] select-none">/</span>
                <h1 className="text-[14.5px] font-semibold text-[var(--ink)] truncate">
                  {sharedChat.title}
                </h1>
                <span className="hidden md:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--hover)] text-[var(--muted)] border border-[var(--border)] shrink-0">
                  {t("sharedPage.badge")}
                </span>
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Tooltip content={t("topbar.toggleTheme")} side="bottom">
              <button
                type="button"
                onClick={toggleTheme}
                className="grid place-items-center w-8 h-8 rounded-[8px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                aria-label={t("topbar.toggleTheme")}
              >
                {theme === "dark" ? (
                  <Sun className="w-4 h-4" />
                ) : (
                  <Moon className="w-4 h-4" />
                )}
              </button>
            </Tooltip>

            <Link
              href="/"
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-[var(--radius-sm)] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-text)] text-[13px] font-medium transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{t("sharedPage.openApp")}</span>
            </Link>
          </div>
        </header>

        {!sharedChat ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="glass max-w-md w-full rounded-[16px] p-7 text-center border border-[var(--glass-border)] bg-[var(--panel)] space-y-3">
              <span className="mx-auto grid place-items-center w-12 h-12 rounded-full bg-[var(--hover)] text-[var(--muted)]">
                <Link2Off className="w-5 h-5" />
              </span>
              <h2 className="text-base font-semibold text-[var(--ink)]">
                {t("sharedPage.notFoundTitle")}
              </h2>
              <p className="text-sm text-[var(--muted)] leading-relaxed">
                {t("sharedPage.notFoundDesc")}
              </p>
              <div className="pt-2">
                <Link
                  href="/"
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-[var(--radius-md)] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-text)] text-sm font-medium transition-colors"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{t("sharedPage.openApp")}</span>
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <main className="flex-1 overflow-y-auto overflow-x-hidden pt-2">
            <MessageList messages={domainMessages} />
          </main>
        )}
      </div>

      <ChatFilesPanel
        isOpen={Boolean(previewFile)}
        chatId={null}
        readOnly
        activeFile={previewFile}
        isFullscreen={isPreviewFullscreen}
        onToggleFullscreen={() => setIsPreviewFullscreen((v) => !v)}
        onClose={() => {
          setPreviewFile(null);
          setIsPreviewFullscreen(false);
        }}
      />
    </div>
  );
}
