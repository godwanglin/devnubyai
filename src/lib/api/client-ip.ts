/**
 * Client IP for logging and rate limiting.
 *
 * Production sits behind Cloudflare, which overwrites `cf-connecting-ip`; the
 * client-settable X-Forwarded-For / X-Real-IP are only honoured outside
 * production (local dev, LAN, tunnels). This is only trustworthy if the origin
 * accepts traffic exclusively from Cloudflare IP ranges.
 */
export function getClientIp(request: Request): string | null {
  const cfIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp.slice(0, 45);

  if (process.env.NODE_ENV === "production") return null;

  const forwarded =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim();
  return forwarded ? forwarded.slice(0, 45) : null;
}
