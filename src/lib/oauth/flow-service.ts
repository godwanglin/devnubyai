import { ApiError } from "@/lib/api/response";
import { saveNewConnection, type SanitizedProviderConnectionDto } from "@/lib/gateways/provider-service";
import { parseCallbackInput } from "./callback-input";
import { ensureLoopbackServer } from "./loopback-listener";
import {
  exchangeXaiCode,
  pollGrokCliToken,
  requestGrokCliDeviceCode,
  startXaiPkceFlow,
  type OAuthProviderId,
  type TokenExchangeResult,
} from "./providers";
import { createOAuthSession, getOAuthSession, type OAuthSession } from "./sessions";
import { exchangeOpenAiCode, startOpenAiPkceFlow } from "./openai-oauth";
import { XAI_CALLBACK_PATH, XAI_LOOPBACK_PORT } from "./constants/xai";
import { OPENAI_CALLBACK_PATH, OPENAI_LOOPBACK_PORT } from "./constants/openai";
import { exchangeAntigravityCode, startAntigravityPkceFlow } from "./antigravity-oauth";
import { ANTIGRAVITY_CALLBACK_PATH, ANTIGRAVITY_LOOPBACK_PORT } from "./constants/antigravity";
import { exchangeClaudeCode, startClaudePkceFlow } from "./claude-oauth";
import { CLAUDE_CALLBACK_PATH, CLAUDE_LOOPBACK_PORT } from "./constants/claude";

const DEFAULT_DEVICE_VERIFICATION_URI = "https://accounts.x.ai/oauth2/device";

export type OAuthInitResult =
  | {
      sessionId: string;
      flow: "pkce";
      authUrl: string;
      redirectUri: string;
      loopbackReady: boolean;
      expiresAt: string;
    }
  | {
      sessionId: string;
      flow: "device_code";
      userCode: string;
      verificationUri: string;
      verificationUriComplete: string;
      intervalMs: number;
      expiresAt: string;
    };

export type OAuthPollResult =
  | { status: "pending" }
  | { status: "success"; connection: SanitizedProviderConnectionDto | null }
  | { status: "error"; error: string };

/** PKCE providers: how to start the flow and which loopback port catches the redirect. */
const PKCE_PROVIDERS: Partial<
  Record<
    OAuthProviderId,
    {
      start: () => { authUrl: string; state: string; codeVerifier: string; redirectUri: string };
      exchange: (
        code: string,
        verifier: string,
        redirectUri?: string,
        state?: string
      ) => Promise<TokenExchangeResult>;
      loopback: { port: number; path: string };
    }
  >
> = {
  xai: {
    start: startXaiPkceFlow,
    exchange: exchangeXaiCode,
    loopback: { port: XAI_LOOPBACK_PORT, path: XAI_CALLBACK_PATH },
  },
  openai: {
    start: startOpenAiPkceFlow,
    exchange: exchangeOpenAiCode,
    loopback: { port: OPENAI_LOOPBACK_PORT, path: OPENAI_CALLBACK_PATH },
  },
  antigravity: {
    start: startAntigravityPkceFlow,
    exchange: exchangeAntigravityCode,
    loopback: { port: ANTIGRAVITY_LOOPBACK_PORT, path: ANTIGRAVITY_CALLBACK_PATH },
  },
  claude: {
    start: startClaudePkceFlow,
    exchange: (code, verifier, redirectUri, state) =>
      exchangeClaudeCode(code, verifier, redirectUri, state),
    loopback: { port: CLAUDE_LOOPBACK_PORT, path: CLAUDE_CALLBACK_PATH },
  },
};

function pkceConfig(provider: OAuthProviderId) {
  const cfg = PKCE_PROVIDERS[provider];
  if (!cfg) throw ApiError.badRequest(`Provider ${provider} does not use PKCE login`);
  return cfg;
}

export async function initOAuthFlow(provider: OAuthProviderId, actorUserId: bigint): Promise<OAuthInitResult> {
  const pkce = PKCE_PROVIDERS[provider];
  if (pkce) {
    const { authUrl, state, codeVerifier, redirectUri } = pkce.start();
    const session = createOAuthSession({
      provider,
      flow: "pkce",
      actorUserId,
      state,
      codeVerifier,
      redirectUri,
      authUrl,
    });
    const loopbackReady = await ensureLoopbackServer(pkce.loopback.port, pkce.loopback.path);
    return {
      sessionId: session.id,
      flow: "pkce",
      authUrl,
      redirectUri,
      loopbackReady,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }

  const device = await requestGrokCliDeviceCode();
  const verificationUri = device.verification_uri || DEFAULT_DEVICE_VERIFICATION_URI;
  const verificationUriComplete =
    device.verification_uri_complete ||
    `${verificationUri}?user_code=${encodeURIComponent(device.user_code)}`;
  const intervalMs = Math.max(1, device.interval ?? 5) * 1000;
  const session = createOAuthSession({
    provider,
    flow: "device_code",
    actorUserId,
    deviceCode: device.device_code,
    userCode: device.user_code,
    verificationUri,
    verificationUriComplete,
    intervalMs,
    nextPollAt: Date.now() + intervalMs,
    ttlMs: (device.expires_in ?? 900) * 1000,
  });

  return {
    sessionId: session.id,
    flow: "device_code",
    userCode: device.user_code,
    verificationUri,
    verificationUriComplete,
    intervalMs,
    expiresAt: new Date(session.expiresAt).toISOString(),
  };
}

function requireSession(provider: OAuthProviderId, sessionId: string, actorUserId: bigint): OAuthSession {
  const session = getOAuthSession(sessionId, provider, actorUserId);
  if (!session) throw ApiError.badRequest("OAuth session expired or not found. Start again.");
  return session;
}

async function finishWithTokens(
  session: OAuthSession,
  tokens: TokenExchangeResult
): Promise<OAuthPollResult> {
  const connection = await saveNewConnection(session.provider, tokens, session.actorUserId);
  session.status = "success";
  session.connectionId = connection.id;
  // Wipe secrets from memory once they have been used
  session.codeVerifier = undefined;
  session.deviceCode = undefined;
  session.capturedCode = undefined;
  return { status: "success", connection };
}

function fail(session: OAuthSession, error: string): OAuthPollResult {
  session.status = "error";
  session.error = error;
  return { status: "error", error };
}

async function exchangePkceCode(session: OAuthSession, code: string): Promise<OAuthPollResult> {
  if (!session.codeVerifier) return fail(session, "OAuth session has no verifier");
  try {
    const tokens = await pkceConfig(session.provider).exchange(
      code,
      session.codeVerifier,
      session.redirectUri,
      session.state
    );
    return await finishWithTokens(session, tokens);
  } catch (err) {
    return fail(session, err instanceof Error ? err.message : "Token exchange failed");
  }
}

/** Called by the popup every few seconds until it gets success or error. */
export async function pollOAuthFlow(
  provider: OAuthProviderId,
  sessionId: string,
  actorUserId: bigint
): Promise<OAuthPollResult> {
  const session = requireSession(provider, sessionId, actorUserId);

  if (session.status === "success") return { status: "success", connection: null };
  if (session.status === "error") return { status: "error", error: session.error ?? "Authorization failed" };
  if (session.busy) return { status: "pending" };

  session.busy = true;
  try {
    if (session.flow === "pkce") {
      // Loopback captured the redirect: exchange it now
      if (!session.capturedCode) return { status: "pending" };
      return await exchangePkceCode(session, session.capturedCode);
    }

    const now = Date.now();
    if (!session.deviceCode) return fail(session, "OAuth session has no device code");
    if (session.nextPollAt && now < session.nextPollAt) return { status: "pending" };

    const result = await pollGrokCliToken(session.deviceCode);
    const interval = session.intervalMs ?? 5000;
    if (result.status === "pending") {
      session.nextPollAt = now + interval;
      return { status: "pending" };
    }
    if (result.status === "slow_down") {
      // RFC 8628: add 5 seconds to the polling interval
      session.intervalMs = interval + 5000;
      session.nextPollAt = now + session.intervalMs;
      return { status: "pending" };
    }
    if (result.status === "error") return fail(session, result.error);
    return await finishWithTokens(session, result.tokens);
  } finally {
    session.busy = false;
  }
}

/** Manual fallback for PKCE flows (xAI, OpenAI) when the loopback redirect can't be reached. */
export async function exchangeManualCallback(
  provider: OAuthProviderId,
  sessionId: string,
  input: string,
  actorUserId: bigint
): Promise<OAuthPollResult> {
  const session = requireSession(provider, sessionId, actorUserId);
  if (session.flow !== "pkce") throw ApiError.badRequest("This provider uses device code login");
  if (session.status === "success") return { status: "success", connection: null };
  if (session.busy) throw ApiError.conflict("Authorization is already being processed");

  const { code, state } = parseCallbackInput(input);
  // A pasted URL carries state: it must match this login attempt (CSRF / mixed-up tabs)
  if (state !== null && state !== session.state) {
    throw ApiError.badRequest("Callback URL belongs to a different login attempt. Start again.");
  }

  session.busy = true;
  try {
    // A failed manual paste must not kill the session: let the admin retry
    if (!session.codeVerifier) return fail(session, "OAuth session has no verifier");
    const exchange = pkceConfig(session.provider).exchange;
    const effectiveState = state || session.state;
    const tokens = await exchange(
      code,
      session.codeVerifier,
      session.redirectUri,
      effectiveState
    ).catch((err: unknown) => {
      throw ApiError.badRequest(err instanceof Error ? err.message : "Token exchange failed");
    });
    return await finishWithTokens(session, tokens);
  } finally {
    session.busy = false;
  }
}
