import { deleteKeysByScan, getCachedJson, invalidateCacheKey, setCachedJson } from "@/lib/redis/client";

/**
 * Redis cache of a chat session row as `getChatSession` returns it, so the chat
 * send path checks ownership / lock / model without a Postgres round-trip.
 * Every write to `chat_sessions` must invalidate it (single row or all of a user's).
 */
export interface ChatSessionRecord {
  id: bigint;
  publicId: string;
  title: string;
  isPinned: boolean;
  isArchived: boolean;
  shareToken: string | null;
  sharedAt: Date | null;
  catalogModelId: bigint | null;
  catalogModelPublicId: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
  projectId: string | null;
  projectInternalId: bigint | null;
  isLocked: boolean;
}

type CachedChatSession = Omit<
  ChatSessionRecord,
  "id" | "catalogModelId" | "projectInternalId" | "sharedAt" | "createdAt" | "updatedAt" | "lastMessageAt"
> & {
  id: string;
  catalogModelId: string | null;
  projectInternalId: string | null;
  sharedAt: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
};

const SESSION_CACHE_TTL = 600; // 10 minutes; writes invalidate it sooner

const sessionKey = (userId: bigint, publicId: string) => `cache:chat:session:${userId}:${publicId}`;

export async function readCachedChatSession(
  userId: bigint,
  publicId: string
): Promise<ChatSessionRecord | null> {
  const cached = await getCachedJson<CachedChatSession>(sessionKey(userId, publicId));
  if (!cached) return null;
  return {
    ...cached,
    id: BigInt(cached.id),
    catalogModelId: cached.catalogModelId ? BigInt(cached.catalogModelId) : null,
    projectInternalId: cached.projectInternalId ? BigInt(cached.projectInternalId) : null,
    sharedAt: cached.sharedAt ? new Date(cached.sharedAt) : null,
    createdAt: new Date(cached.createdAt),
    updatedAt: new Date(cached.updatedAt),
    lastMessageAt: new Date(cached.lastMessageAt),
  };
}

export async function writeCachedChatSession(userId: bigint, record: ChatSessionRecord): Promise<void> {
  const value: CachedChatSession = {
    ...record,
    id: record.id.toString(),
    catalogModelId: record.catalogModelId?.toString() ?? null,
    projectInternalId: record.projectInternalId?.toString() ?? null,
    sharedAt: record.sharedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    lastMessageAt: record.lastMessageAt.toISOString(),
  };
  await setCachedJson(sessionKey(userId, record.publicId), value, SESSION_CACHE_TTL);
}

/** After a write to one chat session. */
export async function invalidateChatSessionCache(userId: bigint, publicId: string): Promise<void> {
  await invalidateCacheKey(sessionKey(userId, publicId));
}

/** After a bulk write (updateMany / deleteMany) over a user's chat sessions. */
export async function invalidateUserChatSessionsCache(userId: bigint): Promise<void> {
  await deleteKeysByScan(`cache:chat:session:${userId}:*`);
}
