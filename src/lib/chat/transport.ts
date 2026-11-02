import { DefaultChatTransport } from "ai";
import {
  extractUIMessageText,
  messageAttachmentsMap,
  messageQuotesMap,
  messageSourceMentionsMap,
} from "./client-mappers";
import { CLIENT_TZ_HEADER, getBrowserTimeZone } from "./timezone";
import type { MessageAttachment } from "@/types";
import type { SourceMention } from "./source-mentions";

function clientTimeZoneHeaders(): Record<string, string> {
  const tz = getBrowserTimeZone();
  return tz ? { [CLIENT_TZ_HEADER]: tz } : {};
}

export function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

export const chatTransport = new DefaultChatTransport({
  api: "/api/v1/chats",
  credentials: "same-origin",
  // Resumes a generation still running on the server (after a reload); replays from the start.
  // Only called when there's an active chatId; on home page (no chat) this is not invoked.
  prepareReconnectToStreamRequest: ({ id, body }) => {
    const chatId = (body as { chatId?: string } | undefined)?.chatId || id;
    if (!chatId) throw new Error("No chatId to resume stream");
    return { api: `/api/v1/chats/${chatId}/stream` };
  },
  prepareSendMessagesRequest: ({ id, messages: reqMessages, trigger, messageId, body }) => {
    const reqBody = (body ?? {}) as {
      chatId?: string;
      model?: string;
      reasoningLevel?: string;
      webSearch?: boolean;
      extendedThinking?: boolean;
      fileIds?: string[];
      quotes?: string[];
      sourceIds?: string[];
      _attachments?: MessageAttachment[];
    };
    const effectiveChatId = reqBody.chatId || id;

    if (trigger === "regenerate-message" && messageId) {
      return {
        api: `/api/v1/chats/${effectiveChatId}/messages/${messageId}/regenerate`,
        headers: clientTimeZoneHeaders(),
        body: {
          model: reqBody.model,
          reasoningLevel: reqBody.reasoningLevel,
        },
      };
    }

    const lastUser = [...reqMessages].reverse().find((m) => m.role === "user");
    const text = lastUser ? extractUIMessageText(lastUser) : "";

    if (lastUser && reqBody._attachments?.length) {
      messageAttachmentsMap.set(lastUser.id, reqBody._attachments);
    }
    if (lastUser && reqBody.quotes?.length) {
      messageQuotesMap.set(lastUser.id, reqBody.quotes);
    }
    const lastUserMentions = (lastUser as { metadata?: { sourceMentions?: SourceMention[] } } | undefined)
      ?.metadata?.sourceMentions;
    if (lastUser && lastUserMentions?.length) {
      messageSourceMentionsMap.set(lastUser.id, lastUserMentions);
    }

    return {
      api: `/api/v1/chats/${effectiveChatId}/messages`,
      headers: clientTimeZoneHeaders(),
      body: {
        content: text,
        model: reqBody.model,
        reasoningLevel: reqBody.reasoningLevel,
        webSearch: reqBody.webSearch,
        extendedThinking: reqBody.extendedThinking,
        fileIds: reqBody.fileIds,
        quotes: reqBody.quotes,
        sourceIds: reqBody.sourceIds,
      },
    };
  },
});
