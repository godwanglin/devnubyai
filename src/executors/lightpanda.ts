import fs from "node:fs";
import { LIGHTPANDA_CONFIG } from "./config";
import { runInSandbox } from "./sandbox";
import { getSandboxSupport } from "./user-workspace";

/**
 * Loads a web page in the Lightpanda headless browser (JavaScript runs, so pages built
 * client-side work) and returns its main content as markdown.
 *
 * Runs inside the OS sandbox as the restricted `devnuby-exec` user with an ephemeral
 * filesystem. Internal addresses are refused twice: by Lightpanda itself
 * (`--block-private-networks`, checked after DNS for every request the page makes) and
 * by the host egress firewall for the sandbox uid.
 */

export class BrowserFetchError extends Error {
  constructor(
    message: string,
    readonly code: "UNAVAILABLE" | "TIMEOUT" | "NAVIGATION" | "BLOCKED" | "FAILED"
  ) {
    super(message);
    this.name = "BrowserFetchError";
  }
}

export interface BrowserFetchResult {
  /** Final URL after redirects */
  url: string;
  status: number;
  contentType: string;
  markdown: string;
  /** Name of the bot challenge that stopped the page (Cloudflare, ...), if any */
  botChallenge: string | null;
}

interface LightpandaJson {
  url?: string;
  http_status?: number;
  headers?: { name?: string; value?: string }[];
  content?: string | null;
  error?: string | null;
  bot_challenge?: unknown;
}

/** Whether the browser can run on this host (Linux sandbox + installed binary). */
export async function isBrowserFetchAvailable(): Promise<boolean> {
  return fs.existsSync(LIGHTPANDA_CONFIG.binary) && (await getSandboxSupport()).ok;
}

function headerValue(headers: LightpandaJson["headers"], name: string): string {
  return headers?.find((h) => h.name?.toLowerCase() === name)?.value ?? "";
}

function describeChallenge(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    return String(v.name ?? v.provider ?? v.type ?? "bot protection");
  }
  return "bot protection";
}

export async function fetchWithBrowser(url: string, signal?: AbortSignal): Promise<BrowserFetchResult> {
  if (!(await isBrowserFetchAvailable())) {
    throw new BrowserFetchError("The web browser is not available on this server.", "UNAVAILABLE");
  }

  const outcome = await runInSandbox({
    argv: [
      LIGHTPANDA_CONFIG.binary,
      "fetch",
      "--log-level", "fatal",
      "--block-private-networks",
      "--wait-until", LIGHTPANDA_CONFIG.waitUntil,
      "--wait-ms", String(LIGHTPANDA_CONFIG.waitMs),
      "--terminate-ms", String(LIGHTPANDA_CONFIG.terminateMs),
      "--dump", "markdown",
      "--strip-mode", "clutter",
      "--dump-max-bytes", String(LIGHTPANDA_CONFIG.dumpMaxBytes),
      "--json",
      // Validated http(s) URL by the caller, so it cannot be read as an option
      url,
    ],
    env: { LIGHTPANDA_DISABLE_TELEMETRY: "true", HOME: "/tmp" },
    cwd: "/tmp",
    timeoutMs: LIGHTPANDA_CONFIG.timeoutMs,
    limits: LIGHTPANDA_CONFIG.limits,
    // JSON escaping can grow the dump; keep the whole object so it parses
    maxOutputChars: LIGHTPANDA_CONFIG.dumpMaxBytes * 3,
    signal,
  });

  if (outcome.aborted) throw new BrowserFetchError("The page load was cancelled.", "FAILED");
  if (outcome.timedOut) {
    throw new BrowserFetchError(`The page did not finish loading within ${LIGHTPANDA_CONFIG.timeoutMs / 1000}s.`, "TIMEOUT");
  }

  let parsed: LightpandaJson;
  try {
    const raw = outcome.stdout;
    parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as LightpandaJson;
  } catch {
    const detail = outcome.stderr.split("\n").filter(Boolean).at(-1) ?? `exit code ${outcome.exitCode}`;
    throw new BrowserFetchError(`The browser could not load the page (${detail.slice(0, 200)}).`, "FAILED");
  }

  if (parsed.error) {
    const blocked = /blocked|private|forbidden/i.test(parsed.error);
    throw new BrowserFetchError(
      blocked
        ? "This address is not allowed (private or internal network)."
        : `Could not open the page: ${parsed.error}.`,
      blocked ? "BLOCKED" : "NAVIGATION"
    );
  }

  return {
    url: parsed.url || url,
    status: parsed.http_status ?? 0,
    contentType: headerValue(parsed.headers, "content-type") || "text/html",
    markdown: (parsed.content ?? "").trim(),
    botChallenge: describeChallenge(parsed.bot_challenge),
  };
}
