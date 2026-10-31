import { db } from "@/lib/db";
import { recordAdminAudit } from "@/lib/admin/audit";
import { chatSettingsSchema, type ChatSettings } from "./settings-shared";

export { chatSettingsSchema, type ChatSettings };

/**
 * Chat agent configuration lives only in `app_settings` (admin-managed from
 * /admin/settings). Like routing settings there are no in-code defaults: the
 * migration/seed provides them and a missing key is a configuration error.
 */
const SETTING_KEYS = {
  maxToolRounds: "chat.max_tool_rounds",
  toolDebug: "chat.tool_debug",
} as const;

export class ChatConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatConfigError";
  }
}

const CACHE_TTL_MS = 30_000;
let cached: { settings: ChatSettings; expiresAt: number } | null = null;

export async function getChatSettings(options?: { forceRefresh?: boolean }): Promise<ChatSettings> {
  const now = Date.now();
  if (!options?.forceRefresh && cached && now < cached.expiresAt) {
    return cached.settings;
  }

  const rows = await db.appSetting.findMany({
    where: { settingKey: { in: Object.values(SETTING_KEYS) } },
    select: { settingKey: true, value: true },
  });
  const byKey = new Map(rows.map((row) => [row.settingKey, row.value]));
  const raw = Object.fromEntries(
    Object.entries(SETTING_KEYS).map(([field, key]) => [field, byKey.get(key)])
  );

  const result = chatSettingsSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => {
        const field = issue.path[0] as keyof typeof SETTING_KEYS;
        return `${SETTING_KEYS[field] ?? String(field)}: ${issue.message}`;
      })
      .join("; ");
    throw new ChatConfigError(`Invalid or missing chat settings in app_settings (${problems})`);
  }

  cached = { settings: result.data, expiresAt: now + CACHE_TTL_MS };
  return result.data;
}

export async function updateChatSettings(
  patch: Partial<ChatSettings>,
  actorUserId: bigint
): Promise<ChatSettings> {
  const before = await getChatSettings({ forceRefresh: true });
  const next = chatSettingsSchema.parse({ ...before, ...patch });

  await db.$transaction(async (tx) => {
    for (const [field, key] of Object.entries(SETTING_KEYS)) {
      const value = next[field as keyof ChatSettings];
      await tx.appSetting.upsert({
        where: { settingKey: key },
        update: { value, updatedBy: actorUserId },
        create: { settingKey: key, value, updatedBy: actorUserId },
      });
    }
    await recordAdminAudit(
      {
        actorUserId,
        action: "chat_settings.update",
        entityType: "app_setting",
        entityId: "chat",
        beforeState: before,
        afterState: next,
      },
      tx
    );
  });

  cached = null;
  return next;
}
