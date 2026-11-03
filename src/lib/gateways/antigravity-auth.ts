import { db } from "@/lib/db";
import { fetchAntigravityProjectId } from "@/lib/oauth/antigravity-oauth";
import {
  ANTIGRAVITY_PROJECT_HEADER,
  ANTIGRAVITY_SESSION_HEADER,
  ANTIGRAVITY_USER_AGENT,
} from "@/lib/oauth/constants/antigravity";
import type { Prisma } from "@/generated/client";

interface AntigravityConn {
  id: bigint;
  providerData: Record<string, unknown> | null;
}

/**
 * Cloud Code Assist needs the account's companion project id in every request.
 * It is discovered at login; accounts connected while discovery failed get it
 * looked up here once and saved back to providerData.
 */
export async function resolveAntigravityProjectId(conn: AntigravityConn, accessToken: string): Promise<string> {
  const stored = conn.providerData?.projectId;
  if (typeof stored === "string" && stored.trim()) return stored.trim();

  const projectId = await fetchAntigravityProjectId(accessToken);
  if (!projectId) return "";

  const providerData = { ...(conn.providerData ?? {}), projectId };
  conn.providerData = providerData;
  await db.providerConnection
    .update({ where: { id: conn.id }, data: { providerData: providerData as Prisma.InputJsonValue } })
    .catch(() => {});
  return projectId;
}

/** Headers for the antigravity adapter; the x-devnuby-* keys are stripped before the request leaves. */
export function buildAntigravityHeaders(
  connId: bigint,
  projectId: string,
  customHeaders: Record<string, string> | null
): Record<string, string> {
  return {
    ...(customHeaders ?? {}),
    "User-Agent": ANTIGRAVITY_USER_AGENT,
    [ANTIGRAVITY_PROJECT_HEADER]: projectId,
    [ANTIGRAVITY_SESSION_HEADER]: connId.toString(),
  };
}
