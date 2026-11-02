const locationCache = new Map<string, string>();

/**
 * Detect location from incoming HTTP request (using Cloudflare headers if present,
 * or resolving via IP geolocation service).
 */
export async function detectLocationFromRequest(
  request: Request,
  ipAddress: string | null
): Promise<string> {
  // 1. Cloudflare Edge Headers (only when the request really came through Cloudflare)
  const viaCloudflare = Boolean(request.headers.get("cf-connecting-ip"));
  const cfCity = viaCloudflare ? request.headers.get("cf-ipcity") : null;
  const cfRegion = request.headers.get("cf-region-code") || request.headers.get("cf-region");
  if (cfCity) {
    const loc = cfRegion ? `${cfCity}, ${cfRegion}` : cfCity;
    if (ipAddress) locationCache.set(ipAddress, loc);
    return loc;
  }

  return resolveLocationFromIp(ipAddress);
}

/**
 * Resolve location from IP address with memory cache and fast timeout.
 */
export async function resolveLocationFromIp(ip: string | null): Promise<string> {
  if (!ip) return "Lokasi Tidak Diketahui";
  if (ip === "127.0.0.1" || ip === "::1" || ip.startsWith("192.168.") || ip.startsWith("10.")) {
    return "Jaringan Lokal (LAN)";
  }

  const cached = locationCache.get(ip);
  if (cached) return cached;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=city,region,countryCode`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as { city?: string; region?: string };
      if (data && data.city) {
        const formatted = data.region ? `${data.city}, ${data.region}` : data.city;
        locationCache.set(ip, formatted);
        return formatted;
      }
    }
  } catch {
    // fallback below
  }

  return ip;
}
