/**
 * Public origin the browser actually used to reach the app.
 *
 * `request.url` reflects the bound interface (e.g. `http://0.0.0.0:3000` when
 * the dev server runs with `-H 0.0.0.0`), which browsers reject with ERR_ADDRESS_INVALID.
 * We resolve in order:
 * 1. NEXT_PUBLIC_APP_URL (if not 0.0.0.0)
 * 2. Host / X-Forwarded-Host header (if not 0.0.0.0)
 * 3. Sanitized request.url with 0.0.0.0 mapped to localhost
 */
export function getPublicOrigin(request?: Request | null): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured && !configured.includes("0.0.0.0")) {
    return configured.replace(/\/$/, "");
  }

  if (request) {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (host && !host.startsWith("0.0.0.0")) {
      const proto =
        request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "http";
      return `${proto}://${host.split(",")[0].trim()}`;
    }

    try {
      const url = new URL(request.url);
      if (url.hostname === "0.0.0.0") {
        url.hostname = "localhost";
      }
      return url.origin;
    } catch {
      // ignore
    }
  }

  return "http://localhost:3000";
}
