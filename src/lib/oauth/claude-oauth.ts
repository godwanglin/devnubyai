import {
  CLAUDE_API_VERSION,
  CLAUDE_AUTH_URL,
  CLAUDE_BETAS,
  CLAUDE_OAUTH_CLIENT_ID,
  CLAUDE_PROFILE_URL,
  CLAUDE_REDIRECT_URI,
  CLAUDE_SCOPES,
  CLAUDE_TOKEN_URL,
  CLAUDE_USER_AGENT,
} from "./constants/claude";
import { generatePKCE } from "./pkce";
import { extractEmailFromToken, extractUserIdFromToken } from "./token-refresh";
import type { TokenExchangeResult } from "./providers";

/** Builds the Claude authorize URL using the official Claude Code CLI flow. */
export function buildClaudeAuthorizeUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    code: "true",
    client_id: CLAUDE_OAUTH_CLIENT_ID,
    response_type: "code",
    redirect_uri: CLAUDE_REDIRECT_URI,
    scope: CLAUDE_SCOPES.join(" "),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });
  return `${CLAUDE_AUTH_URL}?${params.toString()}`;
}

export function startClaudePkceFlow(): {
  authUrl: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
} {
  const { codeVerifier, codeChallenge, state } = generatePKCE(96);
  return {
    authUrl: buildClaudeAuthorizeUrl(state, codeChallenge),
    state,
    codeVerifier,
    redirectUri: CLAUDE_REDIRECT_URI,
  };
}

export interface ClaudeProfileResult {
  email: string | null;
  displayName: string | null;
  upstreamUserId: string | null;
  orgId: string | null;
  organizationName: string | null;
}

/** Fetches Claude OAuth account & organization profile. */
export async function fetchClaudeProfile(accessToken: string): Promise<ClaudeProfileResult> {
  try {
    const res = await fetch(CLAUDE_PROFILE_URL, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "anthropic-beta": CLAUDE_BETAS,
        "anthropic-version": CLAUDE_API_VERSION,
        "User-Agent": CLAUDE_USER_AGENT,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      return {
        email: null,
        displayName: null,
        upstreamUserId: null,
        orgId: null,
        organizationName: null,
      };
    }

    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const account = (data.account && typeof data.account === "object" ? data.account : {}) as Record<string, unknown>;
    const org = (data.organization && typeof data.organization === "object" ? data.organization : {}) as Record<string, unknown>;

    const email =
      (typeof account.email_address === "string" && account.email_address) ||
      (typeof data.email === "string" && data.email) ||
      null;

    const displayName =
      (typeof account.full_name === "string" && account.full_name) ||
      (typeof org.name === "string" && org.name) ||
      (typeof data.name === "string" && data.name) ||
      null;

    const upstreamUserId =
      (typeof account.uuid === "string" && account.uuid) ||
      (typeof data.user_id === "string" && data.user_id) ||
      null;

    const orgId =
      (typeof org.uuid === "string" && org.uuid) ||
      (typeof data.organization_id === "string" && data.organization_id) ||
      null;

    const organizationName = typeof org.name === "string" ? org.name : null;

    return {
      email,
      displayName,
      upstreamUserId,
      orgId,
      organizationName,
    };
  } catch {
    return {
      email: null,
      displayName: null,
      upstreamUserId: null,
      orgId: null,
      organizationName: null,
    };
  }
}

/** Exchange Claude PKCE authorization code for tokens. */
export async function exchangeClaudeCode(
  code: string,
  codeVerifier: string,
  redirectUri: string = CLAUDE_REDIRECT_URI,
  state?: string
): Promise<TokenExchangeResult> {
  // Parse code: may contain state after '#' (e.g. "code#state")
  let authCode = code.trim();
  let codeState = state?.trim() || "";
  if (authCode.includes("#")) {
    const parts = authCode.split("#");
    authCode = parts[0];
    if (!codeState) {
      codeState = parts[1] || "";
    }
  }

  if (!codeState) {
    throw new Error(
      "Claude OAuth requires the state parameter. Please paste the full callback URL from your browser address bar or use code#state format."
    );
  }

  // Claude requires JSON format body with non-empty state
  const payload: Record<string, string> = {
    grant_type: "authorization_code",
    client_id: CLAUDE_OAUTH_CLIENT_ID,
    code: authCode,
    state: codeState,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  };

  const res = await fetch(CLAUDE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== "string") {
    const errObj = json.error as Record<string, unknown> | string | undefined;
    const err =
      (typeof errObj === "object" ? errObj?.message : errObj) ||
      json.error_description ||
      `HTTP ${res.status}`;
    throw new Error(`Claude token exchange failed: ${String(err)}`);
  }

  const accessToken = String(json.access_token);
  const refreshToken = typeof json.refresh_token === "string" ? json.refresh_token : undefined;
  const expiresIn = typeof json.expires_in === "number" ? json.expires_in : undefined;
  const scope = typeof json.scope === "string" ? json.scope : undefined;

  // Fetch account profile & organization
  const profile = await fetchClaudeProfile(accessToken);

  const email = profile.email || extractEmailFromToken(accessToken);
  const upstreamUserId = profile.upstreamUserId || extractUserIdFromToken(accessToken);

  return {
    accessToken,
    refreshToken,
    expiresIn,
    scope,
    email,
    displayName: profile.displayName || (profile.organizationName ? `Claude (${profile.organizationName})` : null),
    upstreamUserId,
    providerData: {
      authMethod: "pkce",
      orgId: profile.orgId,
      organizationName: profile.organizationName,
    },
  };
}
