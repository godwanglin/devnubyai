import net from "net";
import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import { isTargetAllowed, isTargetExplicitlyBlocked } from "@/lib/network/network-rules";

/**
 * SSRF and Network Hardening Utilities.
 * Protects against internal IP leakage, AWS/Cloudflare metadata scraping,
 * and loopback/private range attacks.
 */

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "169.254.169.254", // AWS/Cloudflare instance metadata
  "metadata.google.internal",
  "kubernetes.default",
  "194.233.78.169", // VPS IP
]);

/**
 * Normalizes and checks if an IP is within a private / loopback / link-local range.
 */
export function isPrivateIp(rawIp: string): boolean {
  let ip = rawIp.trim().toLowerCase();

  // Strip brackets from IPv6 if present
  if (ip.startsWith("[") && ip.endsWith("]")) {
    ip = ip.slice(1, -1);
  }

  // Handle IPv4-mapped / NAT64 IPv6 in dotted (::ffff:127.0.0.1) or hex (::ffff:7f00:1) form
  const mapped = /^(?:::ffff:|::|64:ff9b::)(.+)$/.exec(ip);
  if (mapped && ip !== "::1" && ip !== "::") {
    const tail = mapped[1];
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      ip = `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    } else if (net.isIP(tail) === 4) {
      ip = tail;
    }
  }

  // Check explicit blocklist
  if (isTargetExplicitlyBlocked(ip) || BLOCKED_HOSTNAMES.has(ip)) {
    return true;
  }

  const family = net.isIP(ip);
  if (!family) {
    // If it's a numeric integer IP (e.g. 2130706433 for 127.0.0.1) or hex/octal
    if (/^(0x[0-9a-f]+|\d+)$/i.test(ip)) {
      return true; // Block non-standard numeric IP formats
    }
    return false;
  }

  if (family === 4) {
    const octets = ip.split(".").map(Number);
    const [o1, o2] = octets;

    // Loopback 127.0.0.0/8
    if (o1 === 127) return true;
    // Current network 0.0.0.0/8
    if (o1 === 0) return true;
    // Private RFC 1918
    if (o1 === 10) return true; // 10.0.0.0/8
    if (o1 === 172 && o2 >= 16 && o2 <= 31) return true; // 172.16.0.0/12
    if (o1 === 192 && o2 === 168) return true; // 192.168.0.0/16
    // Link-local / AWS metadata 169.254.0.0/16
    if (o1 === 169 && o2 === 254) return true;
    // Broadcast 255.255.255.255
    if (octets.every((o) => o === 255)) return true;
    // Test-Net
    if (o1 === 192 && o2 === 0) return true;
    // Carrier-grade NAT 100.64.0.0/10
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return true;
    // Benchmarking 198.18.0.0/15
    if (o1 === 198 && (o2 === 18 || o2 === 19)) return true;
    // Multicast and reserved 224.0.0.0/3
    if (o1 >= 224) return true;
  }

  if (family === 6) {
    const firstHextet = parseInt(ip.split(":")[0] || "0", 16);
    if (
      ip === "::1" ||
      ip === "::" ||
      ip.startsWith("::ffff:") || // Any remaining IPv4-mapped form
      (firstHextet & 0xfe00) === 0xfc00 || // Unique local fc00::/7
      (firstHextet & 0xffc0) === 0xfe80 || // Link-local fe80::/10
      (firstHextet & 0xff00) === 0xff00 || // Multicast ff00::/8
      ip.startsWith("2001:db8:") // Documentation
    ) {
      return true;
    }
  }

  return false;
}

const MAX_REDIRECTS = 5;

/**
 * Like validateSafeUrl, but also resolves the hostname and rejects it when any
 * address it resolves to is private. Use before every outbound hop.
 */
export async function validateSafeUrlResolved(rawUrl: string): Promise<{
  safe: boolean;
  reason?: string;
  parsedUrl?: URL;
  /** A validated address the connection should be pinned to */
  address?: { address: string; family: number };
}> {
  const result = validateSafeUrl(rawUrl);
  if (!result.safe || !result.parsedUrl) return result;

  // If explicitly allowed in config/network-rules.json, bypass private/loopback rejection
  if (isTargetAllowed(result.parsedUrl)) {
    const hostname = result.parsedUrl.hostname.replace(/^\[|\]$/g, "");
    const literalFamily = net.isIP(hostname);
    if (literalFamily) return { ...result, address: { address: hostname, family: literalFamily } };
    try {
      const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
      if (addresses.length > 0) return { ...result, address: addresses[0] };
    } catch {
      if (hostname === "localhost") return { ...result, address: { address: "127.0.0.1", family: 4 } };
    }
    return { ...result, address: { address: "127.0.0.1", family: 4 } };
  }

  const hostname = result.parsedUrl.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = net.isIP(hostname);
  if (literalFamily) return { ...result, address: { address: hostname, family: literalFamily } };

  try {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    const blocked = addresses.find((a) => isPrivateIp(a.address));
    if (addresses.length === 0 || blocked) {
      return {
        safe: false,
        reason: `Host '${hostname}' resolves to a reserved or private network address.`,
      };
    }
    return { ...result, address: addresses[0] };
  } catch {
    return { safe: false, reason: `Host '${hostname}' could not be resolved.` };
  }
}

const resolvedHostCache = new Map<string, { safe: boolean; reason?: string; expiresAt: number }>();
const RESOLVED_HOST_TTL_MS = 60_000;

/**
 * validateSafeUrlResolved with a 60s per-host cache, for hot paths (gateway
 * calls on every chat turn) where a DNS lookup per request would add latency.
 */
export async function validateSafeUrlCached(rawUrl: string): Promise<{ safe: boolean; reason?: string }> {
  let host: string;
  try {
    const u = new URL(rawUrl);
    if (isTargetAllowed(u)) {
      return { safe: true };
    }
    host = u.host.toLowerCase();
  } catch {
    return { safe: false, reason: "Invalid URL format." };
  }
  const now = Date.now();
  const cached = resolvedHostCache.get(host);
  if (cached && cached.expiresAt > now) return cached;

  const { safe, reason } = await validateSafeUrlResolved(rawUrl);
  if (resolvedHostCache.size > 1000) resolvedHostCache.clear();
  resolvedHostCache.set(host, { safe, reason, expiresAt: now + RESOLVED_HOST_TTL_MS });
  return { safe, reason };
}

interface PinnedRequestInit {
  method?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * One HTTP(S) request whose socket connects to `pinned` instead of re-resolving
 * the hostname, closing the DNS-rebinding gap between validation and connect.
 * TLS still verifies the certificate against the URL's hostname.
 */
export function pinnedRequest(
  url: URL,
  pinned: { address: string; family: number },
  init: PinnedRequestInit
): Promise<Response> {
  const client = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: init.method ?? "GET",
        headers: { "Accept-Encoding": "gzip, deflate, br", ...init.headers },
        signal: init.signal,
        lookup: (_host, options, callback) => {
          if ((options as { all?: boolean }).all) {
            (callback as (e: Error | null, a: { address: string; family: number }[]) => void)(null, [pinned]);
          } else {
            callback(null, pinned.address, pinned.family);
          }
        },
      },
      (res) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
          else if (value !== undefined) headers.set(key, value);
        }

        const encoding = (res.headers["content-encoding"] || "").toLowerCase();
        const decoder =
          encoding === "gzip" || encoding === "x-gzip"
            ? zlib.createGunzip()
            : encoding === "br"
              ? zlib.createBrotliDecompress()
              : encoding === "deflate"
                ? zlib.createInflate()
                : null;
        const stream = decoder ? res.pipe(decoder) : res;
        if (decoder) {
          headers.delete("content-encoding");
          headers.delete("content-length");
          res.on("error", (e) => decoder.destroy(e));
        }

        const status = res.statusCode ?? 502;
        const nullBody = status === 204 || status === 205 || status === 304 || init.method === "HEAD";
        if (nullBody) res.resume();
        resolve(
          new Response(nullBody ? null : (Readable.toWeb(stream as Readable) as ReadableStream), {
            status,
            statusText: res.statusMessage,
            headers,
          })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * fetch()-like request that validates (including DNS) the initial URL and every
 * redirect hop before sending it, and pins each connection to the validated IP.
 */
export async function safeFetch(
  rawUrl: string,
  init: PinnedRequestInit
): Promise<{ response: Response; finalUrl: string } | { blocked: string }> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const check = await validateSafeUrlResolved(current);
    if (!check.safe || !check.parsedUrl || !check.address) {
      return { blocked: check.reason || "URL is not allowed." };
    }
    const response = await pinnedRequest(check.parsedUrl, check.address, init);
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => {});
      current = new URL(location, check.parsedUrl).toString();
      continue;
    }
    return { response, finalUrl: check.parsedUrl.toString() };
  }
  return { blocked: `Too many redirects (max ${MAX_REDIRECTS}).` };
}

/**
 * Validates a target URL before any outbound network request is initiated.
 */
export function validateSafeUrl(rawUrl: string): {
  safe: boolean;
  reason?: string;
  parsedUrl?: URL;
} {
  try {
    const url = new URL(rawUrl);

    // Only allow standard HTTP/HTTPS
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return {
        safe: false,
        reason: `Unsupported protocol '${url.protocol}'. Only http: and https: are permitted.`,
      };
    }

    const hostname = url.hostname.toLowerCase();

    // Check blocked hostnames
    // Allowlist check: if explicitly whitelisted in config/network-rules.json, allow immediately
    if (isTargetAllowed(url)) {
      return { safe: true, parsedUrl: url };
    }

    if (isTargetExplicitlyBlocked(hostname) || BLOCKED_HOSTNAMES.has(hostname)) {
      return {
        safe: false,
        reason: `Host '${hostname}' is restricted (internal/loopback/VPS address).`,
      };
    }

    // Check if hostname is an IP (including mapped IPv6 / numeric formats)
    if (isPrivateIp(hostname)) {
      return {
        safe: false,
        reason: `IP '${hostname}' belongs to a reserved or private network range.`,
      };
    }

    return { safe: true, parsedUrl: url };
  } catch (err: any) {
    return {
      safe: false,
      reason: `Invalid URL format: ${err?.message || "unparseable"}`,
    };
  }
}
