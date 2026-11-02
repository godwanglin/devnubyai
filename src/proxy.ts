import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { uuidv7 } from "@/lib/api/uuidv7";

const REQUEST_ID_HEADER = "x-request-id";
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Next.js 16 Proxy (replaces middleware.ts).
 *
 * Responsibilities:
 * 1. Inject RFC 9562 UUIDv7 into x-request-id header (for tracing).
 * 2. CSRF Origin validation for mutating requests (POST/PUT/PATCH/DELETE) under /api/.
 * 3. Optimistic admin gate: ensure presence of session cookie on /api/v1/admin/**.
 *    (Real role='admin' check happens securely in the service layer via requireAdmin()).
 * 4. Content-Security-Policy (Report-Only) with a per-request nonce for pages.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Request ID (reuse a well-formed incoming one or mint a fresh UUIDv7;
  //    arbitrary client text would let callers forge or flood log lines)
  const incomingReqId = request.headers.get(REQUEST_ID_HEADER)?.trim();
  const requestId =
    incomingReqId && /^[A-Za-z0-9._:-]{1,128}$/.test(incomingReqId) ? incomingReqId : uuidv7();

  // 2. CSRF Origin check for mutating API requests (browser CSP reports carry no
  //    usable Origin and the endpoint only logs, so it is exempt)
  if (
    pathname.startsWith("/api/") &&
    pathname !== CSP_REPORT_PATH &&
    MUTATING_METHODS.has(request.method)
  ) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");

    if (origin && host) {
      try {
        const originUrl = new URL(origin);
        // Compare origin host with the Host header
        if (originUrl.host !== host) {
          return NextResponse.json(
            {
              error: {
                code: "FORBIDDEN",
                message: "Cross-origin requests are forbidden",
                requestId,
              },
            },
            { status: 403, headers: { [REQUEST_ID_HEADER]: requestId } }
          );
        }
      } catch {
        return NextResponse.json(
          {
            error: {
              code: "BAD_REQUEST",
              message: "Invalid Origin header",
              requestId,
            },
          },
          { status: 400, headers: { [REQUEST_ID_HEADER]: requestId } }
        );
      }
    }
  }

  // 3. Optimistic admin gate (check session cookie existence before hitting backend)
  if (pathname.startsWith("/api/v1/admin/")) {
    const sessionCookie = request.cookies.get("devnuby_session")?.value;
    if (!sessionCookie) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required for admin routes",
            requestId,
          },
        },
        { status: 401, headers: { [REQUEST_ID_HEADER]: requestId } }
      );
    }
  }

  // Forward request with injected request-id header
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(REQUEST_ID_HEADER, requestId);

  // 4. CSP (Report-Only for now) with a per-request nonce on page requests. Next reads the
  //    nonce from this request header and stamps it on its own scripts; layout reads x-nonce.
  let csp: string | null = null;
  if (!pathname.startsWith("/api/") && !pathname.startsWith("/workers/")) {
    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
    csp = buildCsp(nonce);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("content-security-policy-report-only", csp);
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  response.headers.set(REQUEST_ID_HEADER, requestId);
  if (csp) response.headers.set("Content-Security-Policy-Report-Only", csp);
  return response;
}

const CSP_REPORT_PATH = "/api/v1/csp-report";
const DOKU_ORIGINS =
  "https://checkout.doku.com https://jokul.doku.com https://sandbox.doku.com https://staging.doku.com";

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Mermaid / KaTeX inject inline styles
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    `frame-src ${DOKU_ORIGINS}`,
    `form-action 'self' ${DOKU_ORIGINS}`,
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    `report-uri ${CSP_REPORT_PATH}`,
  ].join("; ");
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt
     * - public asset files (png, svg, jpg, webp, etc.)
     */
    "/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
