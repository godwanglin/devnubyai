import crypto from "node:crypto";

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
}

/**
 * Generate PKCE code verifier and S256 code challenge (RFC 7636).
 * byteLength defaults to 96 (matches xAI upstream Go / 9router standard).
 */
export function generatePKCE(byteLength = 96): PkcePair {
  const codeVerifier = crypto
    .randomBytes(byteLength)
    .toString("base64url");

  const codeChallenge = crypto
    .createHash("sha256")
    .update(codeVerifier, "utf8")
    .digest("base64url");

  const state = crypto.randomBytes(32).toString("base64url");

  return { codeVerifier, codeChallenge, state };
}
