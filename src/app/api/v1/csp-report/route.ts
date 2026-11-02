import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/api/client-ip";
import { incrementRateCounter } from "@/lib/api/rate-limit";

const MAX_REPORT_BYTES = 16 * 1024;
const REPORTS_PER_MINUTE = 60;

/**
 * POST /api/v1/csp-report
 * Receives browser CSP violation reports (Report-Only phase) and logs a short
 * summary. Unauthenticated by nature, so size- and rate-limited and never echoed.
 */
export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MAX_REPORT_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  const ip = getClientIp(request) ?? "unknown";
  if ((await incrementRateCounter(`rate:csp-report:${ip}`, 60)) > REPORTS_PER_MINUTE) {
    return new NextResponse(null, { status: 429 });
  }

  const raw = (await request.text().catch(() => "")).slice(0, MAX_REPORT_BYTES);
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown> | Record<string, unknown>[];
    const reports = Array.isArray(parsed) ? parsed : [parsed];
    for (const entry of reports.slice(0, 10)) {
      const report = (entry["csp-report"] ?? entry.body ?? entry) as Record<string, unknown>;
      console.warn("[CSP_REPORT]", {
        directive: report["effective-directive"] ?? report.effectiveDirective ?? report["violated-directive"],
        blocked: report["blocked-uri"] ?? report.blockedURL,
        page: report["document-uri"] ?? report.documentURL,
      });
    }
  } catch {
    // ignore malformed reports
  }

  return new NextResponse(null, { status: 204 });
}
