export type Role = "user" | "assistant" | "system";

export interface ToolActivity {
  id: string;
  name: string;
  state: "streaming" | "running" | "completed" | "error";
  durationSec?: number;
  /** Unix timestamp (ms) when the tool execution started on the server */
  startedAt?: number;
  /** Unix timestamp (ms) when the tool execution finished on the server */
  endedAt?: number;
  input?: unknown;
  output?: unknown;
  error?: string;
}

/** One block of an assistant reply in chronological order: prose, reasoning (thought), or a run of tool calls. */
export type MessageSegment =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string; durationSec?: number }
  | { type: "tools"; tools: ToolActivity[] };

export interface MessageAttachment {
  id: string; // SessionFile publicId
  filename: string;
  displayName?: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
  url: string;
  /** Temporary client blob URL for instant zero-latency preview before reload */
  localPreviewUrl?: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
  reasoning?: string | null;
  reasoningDurationSec?: number;
  isReasoningStreaming?: boolean;
  toolCalls?: ToolActivity[];
  /** Text and tool calls interleaved in the order they happened (set when tools were used) */
  segments?: MessageSegment[];
  attachments?: MessageAttachment[];
  /** Excerpts the user selected from the chat and asked about ("Tanya Devnuby") */
  quotes?: string[];
  feedback?: "like" | "dislike" | null;
}

export type SessionGroupKey = "pinned" | "today" | "yesterday" | "week" | "earlier";

export interface Session {
  id: string;
  slug: string;
  title: string;
  isPinned?: boolean;
  isArchived?: boolean;
  shareToken?: string | null;
  messageCount?: number;
  updatedAt: string;
  group: "today" | "yesterday" | "week" | "earlier";
  model: string;
  messages: Message[];
}

export interface SessionFileItem {
  id: string;
  filename: string;
  displayName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  source: string;
  isImage: boolean;
  url: string;
  createdAt: string;
}

export interface ModelOption {
  id: string;
  shortName: string;
  fullName: string;
  meta: string;
  description: string;
  category: "Powerful" | "Fast" | "Balanced" | "Flagship" | string;
  badge?: string | null;
  isLocked?: boolean;
  provider?: {
    slug: string;
    name: string;
    logoKey?: string | null;
    logoUrl?: string | null;
  } | null;
}

export interface QuickPrompt {
  id: string;
  label: string;
  prompt: string;
}

export interface QuotaWindowInfo {
  limitTokens: number | null;
  usedTokens: number;
  usedPercent: number;
  resetAt: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  initials: string;
  role?: string;
  plan: string;
  planLabel: string;
  avatarUrl: string | null;
  quota?: UserQuota;
}

/** Response of /api/v1/me/quota, kept apart from /me so the account loads fast. */
export interface UserQuota {
  usedPercent: number;
  resetInDays: number;
  /** ISO timestamp when the monthly token quota resets */
  resetAt: string;
  usedTokens: number;
  limitTokens: number | null;
  requestCount: number;
  windows: {
    fiveHour: QuotaWindowInfo;
    weekly: QuotaWindowInfo;
    monthly: QuotaWindowInfo & {
      requestCount: number;
      promptTokens: number;
      completionTokens: number;
    };
  };
}

export type Locale = "id" | "en";
export type Theme = "light" | "dark";
export type ReasoningLevel = "0" | "1" | "2" | "3" | "4";
