import { db } from "@/lib/db";
import { recordAdminAudit } from "@/lib/admin/audit";
import { encryptSecret, decryptSecret } from "@/lib/crypto/vault";
import type { DokuConfig, DokuPublicSettings, DokuEnvironment } from "./types";
import type { DokuSettingsPatch } from "./schemas";

const DOKU_SETTING_KEY = "payment.doku";

interface StoredDokuRecord {
  isEnabled?: boolean;
  environment?: DokuEnvironment;
  clientId?: string;
  secretKeyCiphertextHex?: string;
  secretKeyLast4?: string;
  notificationUrl?: string;
  callbackUrl?: string;
}

const CACHE_TTL_MS = 15_000;
let cachedConfig: { config: DokuConfig; source: "database" | "environment" | "none"; expiresAt: number } | null = null;

function getEnvDokuConfig(): Partial<DokuConfig> {
  const isProdDetected =
    process.env.DOKU_ENVIRONMENT === "production" ||
    process.env.DOKU_IS_PRODUCTION === "true" ||
    (Boolean(process.env.DOKU_CLIENT_ID?.startsWith("BRN-")) && process.env.DOKU_ENVIRONMENT !== "sandbox");

  const envMode: DokuEnvironment = isProdDetected ? "production" : "sandbox";

  const clientId = process.env.DOKU_CLIENT_ID?.trim() || "";
  const secretKey = process.env.DOKU_SECRET_KEY?.trim() || "";
  const apiKey = process.env.DOKU_API_KEY?.trim() || "";
  const publicKey = process.env.DOKU_PUBLIC_KEY?.trim() || "";

  const isEnabled =
    process.env.DOKU_IS_ENABLED !== undefined
      ? process.env.DOKU_IS_ENABLED === "true"
      : Boolean(clientId && secretKey);

  return {
    isEnabled,
    environment: envMode,
    clientId,
    secretKey,
    apiKey,
    publicKey,
    notificationUrl: process.env.DOKU_NOTIFICATION_URL?.trim() || "",
    callbackUrl: process.env.DOKU_CALLBACK_URL?.trim() || "",
  };
}

/** Resolves full DOKU configuration with fallback to environment variables */
export async function getDokuConfig(options?: { forceRefresh?: boolean }): Promise<{
  config: DokuConfig;
  source: "database" | "environment" | "none";
}> {
  const now = Date.now();
  if (!options?.forceRefresh && cachedConfig && now < cachedConfig.expiresAt) {
    return { config: cachedConfig.config, source: cachedConfig.source };
  }

  const envDefaults = getEnvDokuConfig();

  let stored: StoredDokuRecord | null = null;
  try {
    const row = await db.appSetting.findUnique({
      where: { settingKey: DOKU_SETTING_KEY },
      select: { value: true },
    });
    if (row?.value && typeof row.value === "object") {
      stored = row.value as StoredDokuRecord;
    }
  } catch {
    // If DB is unreachable, seamlessly proceed with environment fallback
  }

  let secretKey = "";
  if (stored?.secretKeyCiphertextHex) {
    try {
      const buf = Buffer.from(stored.secretKeyCiphertextHex, "hex");
      secretKey = decryptSecret(buf);
    } catch {
      secretKey = "";
    }
  }

  if (!secretKey && envDefaults.secretKey) {
    secretKey = envDefaults.secretKey;
  }

  const clientId = stored?.clientId?.trim() || envDefaults.clientId || "";
  const environment: DokuEnvironment = stored?.environment || envDefaults.environment || "sandbox";
  const isEnabled = stored?.isEnabled ?? envDefaults.isEnabled ?? false;
  const notificationUrl = stored?.notificationUrl || envDefaults.notificationUrl || "";
  const callbackUrl = stored?.callbackUrl || envDefaults.callbackUrl || "";

  let source: "database" | "environment" | "none" = "none";
  if (stored?.clientId || stored?.secretKeyCiphertextHex) {
    source = "database";
  } else if (envDefaults.clientId || envDefaults.secretKey) {
    source = "environment";
  }

  const config: DokuConfig = {
    isEnabled,
    environment,
    clientId,
    secretKey,
    apiKey: envDefaults.apiKey,
    publicKey: envDefaults.publicKey,
    notificationUrl,
    callbackUrl,
  };

  cachedConfig = { config, source, expiresAt: now + CACHE_TTL_MS };
  return { config, source };
}

/** Returns sanitized DOKU settings safe for public admin APIs (secret key masked) */
export async function getDokuPublicSettings(options?: { forceRefresh?: boolean }): Promise<DokuPublicSettings> {
  const { config, source } = await getDokuConfig(options);
  const secretKeyLast4 = config.secretKey ? config.secretKey.slice(-4) : "";

  return {
    isEnabled: config.isEnabled,
    environment: config.environment,
    clientId: config.clientId,
    hasSecretKey: Boolean(config.secretKey),
    secretKeyLast4,
    hasApiKey: Boolean(config.apiKey),
    hasPublicKey: Boolean(config.publicKey),
    notificationUrl: config.notificationUrl || "",
    callbackUrl: config.callbackUrl || "",
    isConfigured: Boolean(config.clientId && config.secretKey),
    source,
  };
}

/** Updates DOKU settings in database app_settings with encrypted secret key */
export async function updateDokuSettings(
  patch: DokuSettingsPatch,
  actorUserId: bigint
): Promise<DokuPublicSettings> {
  const { config: beforeConfig } = await getDokuConfig({ forceRefresh: true });

  const existingRow = await db.appSetting.findUnique({
    where: { settingKey: DOKU_SETTING_KEY },
    select: { value: true },
  });
  const currentRecord = (existingRow?.value as StoredDokuRecord) || {};

  let secretKeyCiphertextHex = currentRecord.secretKeyCiphertextHex;
  let secretKeyLast4 = currentRecord.secretKeyLast4 || (beforeConfig.secretKey ? beforeConfig.secretKey.slice(-4) : "");

  if (patch.secretKey && patch.secretKey.trim()) {
    const rawKey = patch.secretKey.trim();
    const encryptedBuf = encryptSecret(rawKey);
    secretKeyCiphertextHex = Buffer.from(encryptedBuf).toString("hex");
    secretKeyLast4 = rawKey.slice(-4);
  }

  const updatedRecord: StoredDokuRecord = {
    isEnabled: patch.isEnabled !== undefined ? patch.isEnabled : (currentRecord.isEnabled ?? beforeConfig.isEnabled),
    environment: patch.environment || currentRecord.environment || beforeConfig.environment,
    clientId: patch.clientId !== undefined ? patch.clientId : (currentRecord.clientId || beforeConfig.clientId),
    secretKeyCiphertextHex,
    secretKeyLast4,
    notificationUrl: patch.notificationUrl !== undefined ? patch.notificationUrl : (currentRecord.notificationUrl || beforeConfig.notificationUrl || ""),
    callbackUrl: patch.callbackUrl !== undefined ? patch.callbackUrl : (currentRecord.callbackUrl || beforeConfig.callbackUrl || ""),
  };

  await db.appSetting.upsert({
    where: { settingKey: DOKU_SETTING_KEY },
    create: {
      settingKey: DOKU_SETTING_KEY,
      value: updatedRecord as unknown as object,
      updatedBy: actorUserId,
    },
    update: {
      value: updatedRecord as unknown as object,
      updatedBy: actorUserId,
    },
  });

  cachedConfig = null;

  await recordAdminAudit({
    actorUserId,
    action: "update_payment_doku_settings",
    entityType: "app_setting",
    entityId: DOKU_SETTING_KEY,
    beforeState: {
      isEnabled: beforeConfig.isEnabled,
      environment: beforeConfig.environment,
      clientId: beforeConfig.clientId,
      hasSecretKey: Boolean(beforeConfig.secretKey),
      secretKeyLast4: beforeConfig.secretKey.slice(-4),
    },
    afterState: {
      isEnabled: updatedRecord.isEnabled,
      environment: updatedRecord.environment,
      clientId: updatedRecord.clientId,
      hasSecretKey: Boolean(updatedRecord.secretKeyCiphertextHex),
      secretKeyLast4: updatedRecord.secretKeyLast4,
    },
  });

  return getDokuPublicSettings({ forceRefresh: true });
}
