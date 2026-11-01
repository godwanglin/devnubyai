import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { recordAdminAudit } from "@/lib/admin/audit";
import { getCachedJson, setCachedJson } from "@/lib/redis/client";
import {
  CACHE_KEYS,
  CACHE_TTL,
  invalidateSystemPromptsCache,
} from "@/lib/redis/cache-keys";
import {
  renderPromptTemplate,
  type SystemPromptDto,
  type SystemPromptInput,
} from "./system-prompts-shared";

const CACHE_TTL_MS = 30_000;
let activeCache: { prompts: Array<{ content: string }>; expiresAt: number } | null = null;

function toDto(row: {
  publicId: string;
  name: string;
  content: string;
  isActive: boolean;
  sortOrder: number;
  updatedAt: Date;
}): SystemPromptDto {
  return {
    id: row.publicId,
    name: row.name,
    content: row.content,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getActivePrompts() {
  const now = Date.now();
  if (activeCache && now < activeCache.expiresAt) return activeCache.prompts;

  const redisCached = await getCachedJson<Array<{ content: string }>>(CACHE_KEYS.systemPromptsActive());
  if (redisCached && Array.isArray(redisCached) && redisCached.length > 0) {
    activeCache = { prompts: redisCached, expiresAt: now + CACHE_TTL_MS };
    return redisCached;
  }

  const prompts = await db.systemPrompt.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { content: true },
  });

  activeCache = { prompts, expiresAt: now + CACHE_TTL_MS };
  await setCachedJson(CACHE_KEYS.systemPromptsActive(), prompts, CACHE_TTL.SYSTEM_PROMPTS);
  return prompts;
}

export interface PromptContext {
  model: {
    publicId: string;
    displayName: string;
    providerName: string;
    description: string | null;
    contextWindow: number | null;
    supportsVision: boolean;
    supportsTools: boolean;
    supportsReasoning: boolean;
  };
  userName: string;
  now?: Date;
}

/** Joins the active admin prompts with placeholders filled, or null when there are none. */
export async function buildSystemPrompt(ctx: PromptContext): Promise<string | null> {
  const prompts = await getActivePrompts();
  if (prompts.length === 0) return null;

  const now = ctx.now ?? new Date();
  const tz = "Asia/Jakarta";
  const { model } = ctx;
  const capabilities = [
    model.supportsVision && "vision",
    model.supportsTools && "tools",
    model.supportsReasoning && "reasoning",
  ].filter(Boolean);

  const values: Record<string, string> = {
    "model.id": model.publicId,
    "model.name": model.displayName,
    "model.provider": model.providerName,
    "model.description": model.description ?? "",
    "model.context_window": model.contextWindow ? String(model.contextWindow) : "",
    "model.capabilities": capabilities.length ? capabilities.join(", ") : "text",
    "user.name": ctx.userName,
    date: new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(now),
    time: `${new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now)} WIB`,
    year: new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric" }).format(now),
  };

  return prompts.map((p) => renderPromptTemplate(p.content, values)).join("\n\n");
}

// ───────────── Admin CRUD ─────────────

export async function listSystemPrompts(): Promise<SystemPromptDto[]> {
  const cached = await getCachedJson<SystemPromptDto[]>(CACHE_KEYS.systemPromptsAll());
  if (cached && Array.isArray(cached) && cached.length > 0) {
    return cached;
  }

  const rows = await db.systemPrompt.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
  const dtos = rows.map(toDto);

  await setCachedJson(CACHE_KEYS.systemPromptsAll(), dtos, CACHE_TTL.SYSTEM_PROMPTS);
  return dtos;
}

export async function createSystemPrompt(
  input: SystemPromptInput,
  actorUserId: bigint
): Promise<SystemPromptDto> {
  const row = await db.$transaction(async (tx) => {
    const created = await tx.systemPrompt.create({ data: input });
    await recordAdminAudit(
      {
        actorUserId,
        action: "system_prompt.create",
        entityType: "system_prompt",
        entityId: created.publicId,
        afterState: toDto(created) as unknown as Record<string, unknown>,
      },
      tx
    );
    return created;
  });
  activeCache = null;
  await invalidateSystemPromptsCache();
  return toDto(row);
}

export async function updateSystemPrompt(
  publicId: string,
  patch: Partial<SystemPromptInput>,
  actorUserId: bigint
): Promise<SystemPromptDto> {
  const row = await db.$transaction(async (tx) => {
    const existing = await tx.systemPrompt.findUnique({ where: { publicId } });
    if (!existing) throw ApiError.notFound("System prompt not found");
    const updated = await tx.systemPrompt.update({ where: { publicId }, data: patch });
    await recordAdminAudit(
      {
        actorUserId,
        action: "system_prompt.update",
        entityType: "system_prompt",
        entityId: publicId,
        beforeState: toDto(existing) as unknown as Record<string, unknown>,
        afterState: toDto(updated) as unknown as Record<string, unknown>,
      },
      tx
    );
    return updated;
  });
  activeCache = null;
  await invalidateSystemPromptsCache();
  return toDto(row);
}

export async function deleteSystemPrompt(publicId: string, actorUserId: bigint): Promise<void> {
  await db.$transaction(async (tx) => {
    const existing = await tx.systemPrompt.findUnique({ where: { publicId } });
    if (!existing) throw ApiError.notFound("System prompt not found");
    await tx.systemPrompt.delete({ where: { publicId } });
    await recordAdminAudit(
      {
        actorUserId,
        action: "system_prompt.delete",
        entityType: "system_prompt",
        entityId: publicId,
        beforeState: toDto(existing) as unknown as Record<string, unknown>,
      },
      tx
    );
  });
  activeCache = null;
  await invalidateSystemPromptsCache();
}
