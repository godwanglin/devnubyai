"use client";

import { useSyncExternalStore } from "react";
import { Loader2 } from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import { getActivitySnapshot, getServerActivitySnapshot, subscribeActivity } from "@/lib/chat/chat-registry";

/**
 * Sidebar marker of a chat's reply: a spinner while it is generating in this tab,
 * a dot when it finished while the user was looking at another chat.
 * The dot clears once the chat is opened.
 */
export function ChatActivityIndicator({ chatId }: { chatId: string }) {
  const { t } = useI18n();
  const activity = useSyncExternalStore(subscribeActivity, getActivitySnapshot, getServerActivitySnapshot).get(chatId);

  if (activity === "working") {
    return (
      <Loader2
        className="ml-auto w-3.5 h-3.5 shrink-0 animate-spin text-[var(--accent)]"
        aria-label={t("chatSession.working")}
      />
    );
  }
  if (activity === "done") {
    return (
      <span
        className="ml-auto w-2 h-2 shrink-0 rounded-full bg-[var(--accent)]"
        role="status"
        aria-label={t("chatSession.done")}
      />
    );
  }
  return null;
}
