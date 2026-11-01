"use client";

import React from "react";
import Link from "next/link";
import { MessageSquare, ArrowRight } from "lucide-react";
import type { ProjectRecentChat } from "@/lib/projects/types";

export interface ProjectChatsListProps {
  projectId: string;
  chats: ProjectRecentChat[];
}

function formatDateDisplay(isoString: string): string {
  try {
    const d = new Date(isoString);
    const day = d.getDate();
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "Mei",
      "Jun",
      "Jul",
      "Agu",
      "Sep",
      "Okt",
      "Nov",
      "Des",
    ];
    return `${day} ${months[d.getMonth()]}`;
  } catch {
    return "";
  }
}

export function ProjectChatsList({ projectId, chats }: ProjectChatsListProps) {
  if (chats.length === 0) {
    return (
      <div className="py-12 text-center space-y-2">
        <div className="grid place-items-center w-10 h-10 rounded-full bg-[var(--panel-elevated)] border border-[var(--border)] text-[var(--placeholder)] mx-auto">
          <MessageSquare className="w-5 h-5" />
        </div>
        <p className="text-sm font-medium text-[var(--ink)]">
          Belum ada obrolan di proyek ini
        </p>
        <p className="text-xs text-[var(--muted)] max-w-sm mx-auto">
          Ketik pesan di komposer di atas untuk memulai percakapan baru yang terikat
          ke proyek ini.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--border)]">
      {chats.map((chat) => (
        <Link
          key={chat.id}
          href={`/project/${projectId}/c/${chat.id}`}
          className="group flex items-center justify-between gap-4 py-3.5 px-3 rounded-[10px] hover:bg-[var(--hover)] transition-colors cursor-pointer"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="text-sm font-medium text-[var(--ink)] truncate group-hover:text-[var(--accent)] transition-colors">
              {chat.title}
            </h3>
            {chat.preview && (
              <p className="text-xs text-[var(--muted)] truncate">
                {chat.preview}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-[var(--placeholder)]">
              {formatDateDisplay(chat.lastMessageAt)}
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-[var(--placeholder)] opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
          </div>
        </Link>
      ))}
    </div>
  );
}
