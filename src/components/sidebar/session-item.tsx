"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Archive,
  Trash2,
} from "lucide-react";
import { Popover } from "@/components/ui/popover";
import { DropdownItem, DropdownSeparator } from "@/components/ui/dropdown";
import { Tooltip } from "@/components/ui/tooltip";
import { useI18n } from "@/providers/i18n-provider";
import { cn } from "@/lib/cn";
import type { Session } from "@/types";

export interface SessionItemProps {
  session: Session;
  active: boolean;
  onNavigate: () => void;
  onRename: (session: Session) => void;
  onTogglePin: (session: Session) => void;
  onArchive: (session: Session) => void;
  onDelete: (session: Session) => void;
}

export function SessionItem({
  session,
  active,
  onNavigate,
  onRename,
  onTogglePin,
  onArchive,
  onDelete,
}: SessionItemProps) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const isPinned = Boolean(session.isPinned);

  return (
    <div
      className={cn(
        "group relative flex items-center rounded-[8px] transition-colors",
        active
          ? "bg-[var(--accent-soft)] text-[var(--accent)] font-medium"
          : menuOpen
            ? "bg-[var(--hover)] text-[var(--ink)]"
            : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"
      )}
    >
      <Link
        href={`/c/${session.slug || session.id}`}
        onClick={onNavigate}
        className="flex-1 min-w-0 py-2 pl-2.5 pr-1 text-[13.5px] truncate"
      >
        {session.title}
      </Link>

      <div
        className={cn(
          "flex items-center gap-0.5 pr-1 shrink-0 transition-opacity duration-150",
          menuOpen
            ? "w-auto opacity-100"
            : "max-md:w-auto max-md:opacity-100 md:w-0 md:overflow-hidden md:opacity-0 md:group-hover:w-auto md:group-hover:overflow-visible md:group-hover:opacity-100 md:focus-within:w-auto md:focus-within:overflow-visible md:focus-within:opacity-100"
        )}
      >
        <Tooltip
          content={isPinned ? t("sidebarChat.unpin") : t("sidebarChat.pin")}
          side="top"
          align="end"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(session);
            }}
            className={cn(
              "grid place-items-center w-6 h-6 rounded-[6px] transition-colors cursor-pointer",
              isPinned
                ? "text-[var(--ink)] hover:bg-[var(--panel-elevated)]"
                : "text-[var(--muted)] hover:bg-[var(--panel-elevated)] hover:text-[var(--ink)]"
            )}
            aria-label={isPinned ? t("sidebarChat.unpin") : t("sidebarChat.pin")}
          >
            <Pin className={cn("w-3.5 h-3.5", isPinned && "fill-current")} />
          </button>
        </Tooltip>

        <Popover
          isOpen={menuOpen}
          onOpenChange={setMenuOpen}
          side="bottom"
          align="end"
          className="w-[188px]"
          trigger={
            <Tooltip
              content={menuOpen ? "" : t("sidebarChat.moreOptions")}
              side="top"
              align="end"
            >
              <button
                type="button"
                className="grid place-items-center w-6 h-6 rounded-[6px] text-[var(--muted)] hover:bg-[var(--panel-elevated)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                aria-label={t("sidebarChat.moreOptions")}
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </button>
            </Tooltip>
          }
        >
          <div className="space-y-0.5">
            <DropdownItem
              icon={<Pencil className="w-3.5 h-3.5" />}
              onClick={() => {
                setMenuOpen(false);
                onRename(session);
              }}
            >
              {t("sidebarChat.rename")}
            </DropdownItem>

            <DropdownItem
              icon={
                isPinned ? (
                  <PinOff className="w-3.5 h-3.5" />
                ) : (
                  <Pin className="w-3.5 h-3.5" />
                )
              }
              onClick={() => {
                setMenuOpen(false);
                onTogglePin(session);
              }}
            >
              {isPinned ? t("sidebarChat.unpin") : t("sidebarChat.pin")}
            </DropdownItem>

            <DropdownItem
              icon={<Archive className="w-3.5 h-3.5" />}
              onClick={() => {
                setMenuOpen(false);
                onArchive(session);
              }}
            >
              {t("sidebarChat.archive")}
            </DropdownItem>

            <DropdownSeparator />

            <DropdownItem
              danger
              icon={<Trash2 className="w-3.5 h-3.5" />}
              onClick={() => {
                setMenuOpen(false);
                onDelete(session);
              }}
            >
              {t("sidebarChat.delete")}
            </DropdownItem>
          </div>
        </Popover>
      </div>
    </div>
  );
}
