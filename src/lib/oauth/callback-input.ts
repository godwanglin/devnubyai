import { ApiError } from "@/lib/api/response";

/**
 * Accepts a pasted callback URL (http://127.0.0.1:56121/callback?code=...&state=...),
 * a bare query string (code=...&state=...), or the raw code xAI shows on screen.
 */
export function parseCallbackInput(input: string): { code: string; state: string | null } {
  const trimmed = input.trim();
  if (!trimmed) throw ApiError.badRequest("Paste the callback URL or code");

  let params: URLSearchParams | null = null;
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      params = url.searchParams;
      // Some providers put the response in the fragment
      if (!params.get("code") && url.hash) params = new URLSearchParams(url.hash.slice(1));
    } catch {
      throw ApiError.badRequest("Invalid callback URL");
    }
  } else if (/(^|[?&])code=/.test(trimmed)) {
    params = new URLSearchParams(trimmed.replace(/^\?/, ""));
  }

  if (params) {
    const error = params.get("error");
    if (error) throw ApiError.badRequest(params.get("error_description") || error);
    const code = params.get("code");
    if (!code) throw ApiError.badRequest("No code found in the callback URL");
    return { code, state: params.get("state") };
  }

  if (/\s/.test(trimmed)) throw ApiError.badRequest("Code must not contain spaces");
  return { code: trimmed, state: null };
}
