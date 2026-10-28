import net from "net";

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

  // Handle IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }

  // Check explicit blocklist
  if (BLOCKED_HOSTNAMES.has(ip)) {
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
  }

  if (family === 6) {
    if (
      ip === "::1" ||
      ip === "::" ||
      ip.startsWith("fe80:") || // Link-local
      ip.startsWith("fc00:") || // Unique local
      ip.startsWith("fd00:")
    ) {
      return true;
    }
  }

  return false;
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
    if (BLOCKED_HOSTNAMES.has(hostname)) {
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
