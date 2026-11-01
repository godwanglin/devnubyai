import type { DynamicToolUIPart, UIMessage } from "ai";
import type {
  Message,
  MessageAttachment,
  MessageSegment,
  Session,
  ToolActivity,
} from "@/types";
import { isQuotePart } from "./quotes";
import { isFeedbackPart, type FeedbackRating } from "./feedback";

export interface ApiSessionItem {
  id: string; // publicId
  title: string;
  isPinned: boolean;
  isArchived?: boolean;
  shareToken?: string | null;
  catalogModelId: string | null;
  projectId?: string | null;
  isLocked?: boolean;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ApiMessageItem {
  id: string; // publicId
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  reasoning?: string | null;
  reasoningDurationSec?: number;
  parts?: unknown;
  status: string;
  attachments?: MessageAttachment[];
  createdAt: string;
  updatedAt: string;
}

export function classifyDateGroup(
  isoString: string
): "today" | "yesterday" | "week" | "earlier" {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0 && date.getDate() === now.getDate()) return "today";
  if (diffDays <= 1) return "yesterday";
  if (diffDays < 7) return "week";
  return "earlier";
}

export function mapApiSessionToDomain(item: ApiSessionItem): Session {
  return {
    id: item.id,
    slug: item.id,
    title: item.title,
    isPinned: Boolean(item.isPinned),
    isArchived: Boolean(item.isArchived),
    shareToken: item.shareToken ?? null,
    projectId: item.projectId ?? null,
    isLocked: Boolean(item.isLocked),
    messageCount: item.messageCount ?? 0,
    updatedAt: item.lastMessageAt || item.updatedAt,
    group: classifyDateGroup(item.lastMessageAt || item.createdAt),
    model: item.catalogModelId || "",
    messages: [],
  };
}

/** Loads the user's chat list; returns null when the request fails. */
export async function loadSessions(): Promise<Session[] | null> {
  try {
    const res = await fetch("/api/v1/chats?limit=50", { credentials: "same-origin" });
    if (!res.ok) return null;
    const json = await res.json();
    const items: ApiSessionItem[] = json.data ?? [];
    return items.map(mapApiSessionToDomain);
  } catch {
    return null;
  }
}

/**
 * Extracts text content from an AI SDK UIMessage. Separate text parts (one per
 * tool step) become separate paragraphs instead of running into each other.
 */
export function extractUIMessageText(msg: UIMessage): string {
  return msg.parts
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
}

// Map message creation timestamps and attachments by message ID to preserve state across streaming
export const messageTimestamps = new Map<string, string>();
export const messageAttachmentsMap = new Map<string, MessageAttachment[]>();
export const messageQuotesMap = new Map<string, string[]>();
export const messageFeedbackMap = new Map<string, FeedbackRating>();

/**
 * Maps an array of AI SDK UIMessages into the UI's simple Message format.
 */
export function mapUIMessagesToDomain(uiMessages: UIMessage[]): Message[] {
  return uiMessages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      let createdAt = messageTimestamps.get(m.id);
      if (!createdAt) {
        createdAt = new Date().toISOString();
        messageTimestamps.set(m.id, createdAt);
      }
      const msgMeta = (m as { metadata?: { attachments?: MessageAttachment[]; quotes?: string[] } }).metadata;
      const attachments = messageAttachmentsMap.get(m.id) || msgMeta?.attachments;
      const quotes = messageQuotesMap.get(m.id) || msgMeta?.quotes;
      if (msgMeta?.attachments && !messageAttachmentsMap.has(m.id)) {
        messageAttachmentsMap.set(m.id, msgMeta.attachments);
      }
      if (msgMeta?.quotes && !messageQuotesMap.has(m.id)) {
        messageQuotesMap.set(m.id, msgMeta.quotes);
      }
      const feedback = messageFeedbackMap.get(m.id) ?? null;
      let isReasoningStreaming = false;
      let currentReasoningDurationSec: number | undefined = undefined;
      const toolCalls: ToolActivity[] = [];
      const segments: MessageSegment[] = [];

      for (const part of m.parts) {
        if (part.type === "text") {
          if (!part.text.trim()) continue;
          const last = segments[segments.length - 1];
          if (last?.type === "text") {
            last.text += `\n\n${part.text}`;
          } else {
            segments.push({ type: "text", text: part.text });
          }
        } else if (part.type === "reasoning") {
          // Push each reasoning block as its own segment to enable per-step accordion rendering
          if (part.text.trim()) {
            segments.push({
              type: "reasoning",
              text: part.text,
              durationSec: part.state === "streaming" ? undefined : currentReasoningDurationSec,
            });
          }
          if (part.state === "streaming") isReasoningStreaming = true;
        } else if ((part as { type?: string }).type === "reasoning-meta") {
          const meta = part as { type: string; durationSec?: number };
          if (typeof meta.durationSec === "number") {
            currentReasoningDurationSec = meta.durationSec;
            // If the last segment was reasoning, update its duration
            const lastSeg = segments[segments.length - 1];
            if (lastSeg && lastSeg.type === "reasoning") {
              lastSeg.durationSec = currentReasoningDurationSec;
            }
          }
        } else if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
          const tool = part as DynamicToolUIPart & {
            durationSec?: number;
            startedAt?: number;
            endedAt?: number;
          };
          const meta = (tool.toolMetadata ?? {}) as Record<string, unknown>;
          const rawDuration = typeof tool.durationSec === "number" ? tool.durationSec : meta.durationSec;
          const rawStartedAt = typeof tool.startedAt === "number" ? tool.startedAt : meta.startedAt;
          const rawEndedAt = typeof tool.endedAt === "number" ? tool.endedAt : meta.endedAt;

          const activity: ToolActivity = {
            id: tool.toolCallId,
            name: tool.toolName ?? part.type.slice("tool-".length),
            state:
              tool.state === "input-streaming"
                ? "streaming"
                : tool.state === "output-available"
                  ? "completed"
                  : tool.state === "output-error"
                    ? "error"
                    : "running",
            durationSec: typeof rawDuration === "number" ? rawDuration : undefined,
            startedAt: typeof rawStartedAt === "number" ? rawStartedAt : undefined,
            endedAt: typeof rawEndedAt === "number" ? rawEndedAt : undefined,
            input: tool.input,
            output: tool.state === "output-available" ? tool.output : undefined,
            error: tool.state === "output-error" ? tool.errorText : undefined,
          };
          toolCalls.push(activity);
          const last = segments[segments.length - 1];
          if (last?.type === "tools") {
            last.tools.push(activity);
          } else {
            segments.push({ type: "tools", tools: [activity] });
          }
        }
      }

      // Compute aggregate reasoning for backward compatibility (ThinkingAccordion in message-bubble)
      const fullReasoning = segments
        .filter((s) => s.type === "reasoning")
        .map((s) => s.text)
        .join("\n\n");

      const aggregateReasoningDuration = segments
        .filter((s): s is { type: "reasoning"; text: string; durationSec: number } => s.type === "reasoning" && typeof (s as { durationSec?: number }).durationSec === "number")
        .reduce((sum, s) => sum + (s.durationSec ?? 0), 0);

      return {
        id: m.id,
        role: m.role as "user" | "assistant",
        content: extractUIMessageText(m),
        createdAt,
        reasoning: fullReasoning || null,
        reasoningDurationSec: aggregateReasoningDuration || undefined,
        isReasoningStreaming,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        segments: segments.length > 0 ? segments : undefined,
        attachments: attachments && attachments.length > 0 ? attachments : undefined,
        quotes: quotes && quotes.length > 0 ? quotes : undefined,
        feedback,
      };
    });
}

/**
 * Maps database messages to AI SDK UIMessage format.
 */
export function mapApiMessagesToUIMessages(items: ApiMessageItem[]): UIMessage[] {
  return items
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      messageTimestamps.set(m.id, m.createdAt);
      if (m.attachments && m.attachments.length > 0) {
        messageAttachmentsMap.set(m.id, m.attachments);
      }

      let parsedSavedParts: UIMessage["parts"] = [];
      if (typeof m.parts === "string" && m.parts.trim().length > 0) {
        try {
          const json = JSON.parse(m.parts);
          if (Array.isArray(json)) parsedSavedParts = json as UIMessage["parts"];
        } catch {}
      } else if (Array.isArray(m.parts)) {
        parsedSavedParts = m.parts as UIMessage["parts"];
      }

      // Quote & feedback parts are UI metadata, not AI SDK parts: keep them in side maps
      const rawParts = parsedSavedParts as unknown[];
      const quotes = rawParts.filter(isQuotePart).map((p) => p.text);
      if (quotes.length > 0) {
        messageQuotesMap.set(m.id, quotes);
      }

      const feedbackPart = rawParts.find(isFeedbackPart);
      if (feedbackPart) {
        messageFeedbackMap.set(m.id, feedbackPart.rating);
      } else {
        messageFeedbackMap.delete(m.id);
      }

      parsedSavedParts = parsedSavedParts.filter(
        (p) => !isQuotePart(p) && !isFeedbackPart(p)
      );

      // Newer replies store each step's text in order among the tool parts; older
      // ones (and failed/aborted replies) only have `content`, appended at the end.
      const hasOrderedText = parsedSavedParts.some((p) => p.type === "text");

      return {
        id: m.id,
        role: m.role as "user" | "assistant",
        parts: [
          ...(m.reasoning
            ? [{ type: "reasoning" as const, text: m.reasoning, state: "done" as const }]
            : []),
          ...parsedSavedParts,
          ...(hasOrderedText
            ? []
            : [{ type: "text" as const, text: m.content, state: "done" as const }]),
        ],
      };
    });
  }

  /**
   * Map legacy assistant messages (stored with m.reasoning + m.reasoningDurationSec)
   * to segments array including reasoning segments for backward compatibility.
   */
  export function legacyMessageToSegments(m: ApiMessageItem): MessageSegment[] {
    const segments: MessageSegment[] = [];
    if (m.reasoning && m.reasoning.trim()) {
      segments.push({
        type: "reasoning",
        text: m.reasoning,
        durationSec: m.reasoningDurationSec,
      });
    }
    return segments;
  }
