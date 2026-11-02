import crypto from "node:crypto";
import type { OAuthProviderId } from "./providers";

/**
 * Pending OAuth login attempts, kept server-side so the PKCE verifier and the
 * device_code never reach the browser. The browser only holds the session id.
 * Pinned on globalThis so dev HMR and separate route modules share one store.
 */
export type OAuthSessionStatus = "pending" | "success" | "error";

export interface OAuthSession {
  id: string;
  provider: OAuthProviderId;
  flow: "pkce" | "device_code";
  actorUserId: bigint;
  status: OAuthSessionStatus;
  createdAt: number;
  expiresAt: number;
  // PKCE
  state?: string;
  codeVerifier?: string;
  redirectUri?: string;
  authUrl?: string;
  capturedCode?: string;
  // Device code
  deviceCode?: string;
  userCode?: string;
  verificationUri?: string;
  verificationUriComplete?: string;
  intervalMs?: number;
  nextPollAt?: number;
  // Outcome
  connectionId?: string;
  error?: string;
  // Guards against two polls exchanging the same code concurrently
  busy?: boolean;
}

const SESSION_TTL_MS = 15 * 60 * 1000;

const globalStore = globalThis as unknown as { __oauthSessions?: Map<string, OAuthSession> };
const sessions: Map<string, OAuthSession> = (globalStore.__oauthSessions ??= new Map());

function sweep(now = Date.now()): void {
  for (const [id, s] of sessions) {
    if (s.expiresAt <= now) sessions.delete(id);
  }
}

export function createOAuthSession(
  input: Omit<OAuthSession, "id" | "status" | "createdAt" | "expiresAt"> & { ttlMs?: number }
): OAuthSession {
  sweep();
  const now = Date.now();
  const { ttlMs, ...rest } = input;
  const session: OAuthSession = {
    ...rest,
    id: crypto.randomBytes(18).toString("base64url"),
    status: "pending",
    createdAt: now,
    expiresAt: now + (ttlMs ?? SESSION_TTL_MS),
  };
  sessions.set(session.id, session);
  return session;
}

/** Returns the session only if it belongs to this provider and admin. */
export function getOAuthSession(
  id: string,
  provider: OAuthProviderId,
  actorUserId: bigint
): OAuthSession | null {
  sweep();
  const s = sessions.get(id);
  if (!s || s.provider !== provider || s.actorUserId !== actorUserId) return null;
  return s;
}

/** Loopback callback: attach the code to the pending PKCE session with this state. */
export function captureCodeForState(state: string, code: string): boolean {
  sweep();
  for (const s of sessions.values()) {
    if (s.flow === "pkce" && s.state === state && s.status === "pending") {
      s.capturedCode = code;
      return true;
    }
  }
  return false;
}

export function failCodeForState(state: string, error: string): void {
  for (const s of sessions.values()) {
    if (s.flow === "pkce" && s.state === state && s.status === "pending") {
      s.status = "error";
      s.error = error;
    }
  }
}

export function deleteOAuthSession(id: string): void {
  sessions.delete(id);
}
