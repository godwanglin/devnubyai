/** Header carrying the browser's IANA time zone (e.g. "Asia/Jakarta"). Only the zone is
 * trusted from the client; the clock itself always comes from the server. */
export const CLIENT_TZ_HEADER = "x-client-tz";

/** Most users are in Indonesia, so WIB is the fallback when the client sends nothing usable. */
export const DEFAULT_TIME_ZONE = "Asia/Jakarta";

export function getBrowserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Returns the request's client time zone if it is a valid IANA zone, else the default. */
export function resolveClientTimeZone(request: Request): string {
  const raw = request.headers.get(CLIENT_TZ_HEADER)?.trim();
  if (!raw || raw.length > 64) return DEFAULT_TIME_ZONE;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: raw }).resolvedOptions().timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}
