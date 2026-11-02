import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";
import { safeFetch, validateSafeUrl } from "./ssrf";

export interface FetchUrlParams {
  url: string;
  maxChars?: number;
}

export interface FetchUrlData {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title?: string;
  text: string;
  truncated: boolean;
}

const MAX_CHARS_DEFAULT = 12_000;
const MAX_CHARS_CAP = 40_000;
const MAX_BYTES = 2 * 1024 * 1024; // 2MB hard cap
const TIMEOUT_MS = 15_000;

function stripTags(html: string): string {
  // Remove script/style blocks
  let out = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<style[\s\S]*?<\/style>/gi, "");
  // Convert common block tags to newlines
  out = out.replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, "\n");
  out = out.replace(/<br\s*\/?>/gi, "\n");
  // Strip remaining tags
  out = out.replace(/<[^>]+>/g, "");
  // Decode basic entities
  out = out
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  // Collapse whitespace
  out = out.replace(/[ \t]+/g, " ");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

/** Reads the body but stops (returns null) once it exceeds maxBytes. */
async function readBodyCapped(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function extractTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return undefined;
  return m[1].replace(/<[^>]+>/g, "").trim().slice(0, 200) || undefined;
}

export const fetchUrlTool: ToolDefinition<FetchUrlParams, FetchUrlData> = {
  name: "fetch_url",
  description:
    "Fetches a public web page and returns its readable text content. Use to read documentation, articles, or any URL the user provides. SSRF-protected: private/loopback/internal IPs and localhost are blocked. Returns plain text (HTML tags stripped).",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The absolute http(s) URL to fetch.",
        required: true,
      },
      maxChars: {
        type: "number",
        description: "Maximum characters of text to return (default 12000, max 40000).",
        default: MAX_CHARS_DEFAULT,
      },
    },
    required: ["url"],
  },
  execute: async (
    params: FetchUrlParams,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult<FetchUrlData>> => {
    const startTime = Date.now();
    const rawUrl = String(params?.url ?? "").trim();
    if (!rawUrl) {
      return {
        success: false,
        error: { code: "INVALID_PARAM", message: "Parameter 'url' cannot be empty." },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    const validation = validateSafeUrl(rawUrl);
    if (!validation.safe || !validation.parsedUrl) {
      return {
        success: false,
        error: { code: "SSRF_BLOCKED", message: validation.reason || "URL is not allowed." },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    const url = validation.parsedUrl.toString();
    const maxChars = Math.min(
      Math.max(Number(params?.maxChars) || MAX_CHARS_DEFAULT, 500),
      MAX_CHARS_CAP
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const signal = context.signal
      ? AbortSignal.any([context.signal, controller.signal])
      : controller.signal;

    try {
      // Validates DNS and every redirect hop before the request is sent (SSRF guard)
      const fetched = await safeFetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "DevnubyAIRuntime/1.0 (+https://devnuby.ai)",
          Accept: "text/html,text/plain,application/json,application/xml,*/*;q=0.8",
        },
        signal,
      });

      if ("blocked" in fetched) {
        return {
          success: false,
          error: { code: "SSRF_BLOCKED", message: fetched.blocked },
          metadata: { durationMs: Date.now() - startTime },
        };
      }

      const { response: res, finalUrl } = fetched;

      if (!res.ok) {
        return {
          success: false,
          error: {
            code: "EXECUTION_ERROR",
            message: `HTTP ${res.status} ${res.statusText}`,
          },
          metadata: { durationMs: Date.now() - startTime },
        };
      }

      const contentType = res.headers.get("content-type") || "application/octet-stream";
      const buffer = await readBodyCapped(res, MAX_BYTES);
      if (!buffer) {
        return {
          success: false,
          error: {
            code: "INVALID_PARAM",
            message: `Response exceeds ${MAX_BYTES} bytes limit.`,
          },
          metadata: { durationMs: Date.now() - startTime },
        };
      }

      const raw = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
      const isHtml = contentType.includes("text/html") || /<html/i.test(raw);
      const title = isHtml ? extractTitle(raw) : undefined;
      const text = isHtml ? stripTags(raw) : raw.trim();

      const truncated = text.length > maxChars;
      const finalText = truncated ? text.slice(0, maxChars) + "\n…[truncated]" : text;

      return {
        success: true,
        data: {
          url,
          finalUrl,
          status: res.status,
          contentType,
          title,
          text: finalText,
          truncated,
        },
        metadata: { durationMs: Date.now() - startTime, provider: "fetch-url" },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Fetch failed";
      return {
        success: false,
        error: { code: "EXECUTION_ERROR", message: `Failed to fetch URL: ${message}` },
        metadata: { durationMs: Date.now() - startTime },
      };
    } finally {
      clearTimeout(timer);
    }
  },
};
