import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { LOG_DIR, getAvailableLogDates } from "@/lib/logger/file-logger";

export interface ParsedRoutingRecord {
  id: string;
  timestamp: Date;
  outcome: string;
  errorClass: string | null;
  latencyMs: number;
  ttftMs: number | null;
  promptTokens: number;
  completionTokens: number;
  catalogModelId: string | null;
  gatewayId: string | null;
  userId: string | null;
  attemptNo: number;
}

const LOG_HEADER_REGEX =
  /^<log\s+index="(\d+)"\s+id="([^"]+)"\s+type="routing"(?:\s+level="[^"]*")?(?:\s+timestamp="([^"]*)")?(?:\s+userid="([^"]*)")?>/;

/**
 * Parses all routing log files from .logs/ into memory.
 */
export async function loadRoutingLogRecords(): Promise<ParsedRoutingRecord[]> {
  const dates = await getAvailableLogDates();
  const records: ParsedRoutingRecord[] = [];

  for (const dateStr of dates) {
    const filePath = path.join(LOG_DIR, `${dateStr}.log`);
    if (!fs.existsSync(filePath)) continue;

    const stream = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let inRoutingLog = false;
    let currentId = "";
    let currentTimestampStr = "";
    let currentTagUserId: string | null = null;
    const bodyLines: string[] = [];

    for await (const line of rl) {
      if (!inRoutingLog) {
        const match = line.match(LOG_HEADER_REGEX);
        if (match) {
          inRoutingLog = true;
          currentId = match[2];
          currentTimestampStr = match[3] || "";
          currentTagUserId = match[4] || null;
          bodyLines.length = 0;
        }
      } else {
        if (line.trim() === "</log>") {
          inRoutingLog = false;
          try {
            const rawBody = bodyLines.join("\n");
            const data = JSON.parse(rawBody);

            const ts = currentTimestampStr ? new Date(currentTimestampStr) : new Date(dateStr);
            const validTs = Number.isNaN(ts.getTime()) ? new Date() : ts;
            const resolvedUserId = currentTagUserId || (data.userId ? String(data.userId) : null);
            const catalogModelId = data.catalogModelId ? String(data.catalogModelId) : null;
            const promptTokens = typeof data.promptTokens === "number" ? Math.max(0, data.promptTokens) : 0;
            const completionTokens =
              typeof data.completionTokens === "number" ? Math.max(0, data.completionTokens) : 0;

            if (Array.isArray(data.candidates) && data.candidates.length > 0) {
              data.candidates.forEach((cand: Record<string, unknown>, idx: number) => {
                const isLast = idx === data.candidates.length - 1;
                const candOutcome = String(cand.outcome || data.outcome || "unknown").toLowerCase();
                const candLatency = typeof cand.latencyMs === "number" ? Math.max(0, cand.latencyMs) : 0;
                const candTtft = typeof cand.ttftMs === "number" ? Math.max(0, cand.ttftMs) : null;

                records.push({
                  id: `${currentId}_${idx + 1}`,
                  timestamp: validTs,
                  outcome: candOutcome,
                  errorClass: cand.errorClass ? String(cand.errorClass) : null,
                  latencyMs: candLatency,
                  ttftMs: candTtft,
                  promptTokens: isLast ? promptTokens : 0,
                  completionTokens: isLast ? completionTokens : 0,
                  catalogModelId,
                  gatewayId: cand.gatewayId ? String(cand.gatewayId) : data.gatewayId ? String(data.gatewayId) : null,
                  userId: resolvedUserId,
                  attemptNo: typeof cand.attemptNo === "number" ? cand.attemptNo : idx + 1,
                });
              });
            } else {
              const outcome = String(data.outcome || "unknown").toLowerCase();
              const latencyMs = typeof data.latencyMs === "number" ? Math.max(0, data.latencyMs) : 0;
              const ttftMs = typeof data.ttftMs === "number" ? Math.max(0, data.ttftMs) : null;

              records.push({
                id: currentId,
                timestamp: validTs,
                outcome,
                errorClass: data.errorClass ? String(data.errorClass) : null,
                latencyMs,
                ttftMs,
                promptTokens,
                completionTokens,
                catalogModelId,
                gatewayId: data.gatewayId ? String(data.gatewayId) : null,
                userId: resolvedUserId,
                attemptNo: typeof data.attemptNo === "number" ? data.attemptNo : 1,
              });
            }
          } catch {
            // Ignore malformed JSON lines
          }
        } else {
          bodyLines.push(line);
        }
      }
    }
  }

  // Sort chronologically ascending
  records.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return records;
}
