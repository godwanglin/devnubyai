export interface SessionWithMeta {
  id: string; // publicId
  title: string;
  isPinned: boolean;
  isArchived: boolean;
  shareToken: string | null;
  catalogModelId: string | null;
  projectId?: string | null;
  isLocked?: boolean;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface MessageAttachmentDto {
  id: string; // SessionFile publicId
  filename: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  isImage: boolean;
  url: string;
}

export interface ChatMessageDto {
  id: string; // publicId
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  reasoning: string | null;
  parts: unknown;
  status: string;
  errorCode?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  catalogModelId?: string | null;
  attachments?: MessageAttachmentDto[];
  createdAt: string;
  updatedAt: string;
}

export interface ListChatMessagesResult {
  session: {
    id: string;
    title: string;
    isPinned: boolean;
    isArchived: boolean;
    shareToken: string | null;
    catalogModelId: string | null;
    lastMessageAt: string;
    createdAt: string;
    updatedAt: string;
  };
  messages: ChatMessageDto[];
  nextCursor: string | null;
}
