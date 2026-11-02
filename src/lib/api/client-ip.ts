import { isIP } from "node:net";

/**
 * Extracts and validates the client's real IP address from HTTP request headers.
 *
 * Header precedence:
 * 1. `cf-connecting-ip`: Injected by Cloudflare Edge proxy
 * 2. `x-real-ip`: Set by Nginx reverse proxy from $remote_addr (authoritative for direct/Nginx proxy)
 * 3. `true-client-ip`: Injected by Akamai / Cloudflare Enterprise
 * 4. `x-forwarded-for`: Standard proxy chain header; takes the first valid client IP
 * 5. `remote-host`: Fallback set by Nginx
 */
export function getClientIp(request: Request): string | null {
  // 1. Cloudflare Edge header
  const cfIp = cleanIp(request.headers.get("cf-connecting-ip"));
  if (cfIp) return cfIp;

  // 2. Nginx X-Real-IP (trusted from Nginx proxy_set_header X-Real-IP $remote_addr)
  const realIp = cleanIp(request.headers.get("x-real-ip"));
  if (realIp) return realIp;

  // 3. True-Client-IP header
  const trueClientIp = cleanIp(request.headers.get("true-client-ip"));
  if (trueClientIp) return trueClientIp;

  // 4. X-Forwarded-For (take the first valid public/client IP in chain)
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const parts = forwardedFor.split(",").map((p) => p.trim());
    for (const part of parts) {
      const cleaned = cleanIp(part);
      if (cleaned) return cleaned;
    }
  }

  // 5. REMOTE-HOST fallback
  const remoteHost = cleanIp(request.headers.get("remote-host"));
  if (remoteHost) return remoteHost;

  return null;
}

function cleanIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let ip = raw.trim();

  // Strip IPv4 port if present (e.g. "202.46.68.40:51234")
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(ip)) {
    ip = ip.split(":")[0];
  }

  // Strip bracketed IPv6 with port (e.g. "[2001:db8::1]:8080")
  if (/^\[([a-fA-F0-9:]+)\](?::\d+)?$/.test(ip)) {
    const match = ip.match(/^\[([a-fA-F0-9:]+)\]/);
    if (match) ip = match[1];
  }

  // Validate format using node:net isIP (returns 4 for IPv4, 6 for IPv6, 0 for invalid)
  if (isIP(ip) !== 0) {
    return ip.slice(0, 45);
  }

  return null;
}
