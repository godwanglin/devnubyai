import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";
import { safeFetch, validateSafeUrl } from "./ssrf";
import { extractYouTubeVideoId, parseTimestamp } from "./youtube/detect";
import { loadYouTubeVideo, type YouTubeVideo } from "./youtube/fetch-video";
import { sliceTranscript } from "./youtube/transcript";
import { YtDlpError } from "./youtube/ytdlp";
import { rememberFetchedVideo } from "@/lib/chat/redis-chat-state";

export interface FetchUrlParams {
  url: string;
  maxChars?: number;
  /**
   * YouTube only: seconds (or "m:ss" / "h:mm:ss") to read the transcript from.
   * The result says where it continues, so a long video is read in parts.
   */
  startAt?: number | string;
}

export interface FetchUrlData {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title?: string;
  text: string;
  truncated: boolean;
  /** Present when the URL is a YouTube video: metadata plus a transcript slice. */
  video?: YouTubeVideoData;
}

/** What the model sees for a YouTube video. `savedFile` is the server copy to reuse. */
export interface YouTubeVideoData {
  kind: "video";
  videoId: string;
  title: string;
  channel: string | null;
  channelUrl: string | null;
  uploadDate: string | null;
  duration: string | null;
  durationSeconds: number | null;
  viewCount: number | null;
  likeCount: number | null;
  isLive: boolean;
  thumbnail: string | null;
  chapters: { start: string; title: string }[];
  tags: string[];
  description: string;
  transcript: {
    language: string;
    source: "manual" | "auto";
    /** `[m:ss] text` lines for this slice */
    text: string;
    fromSeconds: number;
    /** Pass back as `startAt` to read the following part; null when this is the end */
    nextStartAt: number | null;
    totalChars: number;
  } | null;
  /** Server file holding the full video data; read it back instead of refetching */
  savedFile: string | null;
  /** True when served from the saved copy rather than YouTube */
  fromSavedFile: boolean;
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

const TEXT_CONTENT_TYPE = /^(?:text\/|application\/(?:json|ld\+json|xml|xhtml\+xml|rss\+xml|atom\+xml|javascript)|image\/svg\+xml)/i;

/** True for a body that is not text: a known binary type, a PDF/ZIP signature, or NUL bytes up front. */
function isBinaryBody(contentType: string, body: Uint8Array): boolean {
  const head = body.subarray(0, 1024);
  const signature = new TextDecoder("latin1").decode(head.subarray(0, 5));
  if (signature.startsWith("%PDF") || signature.startsWith("PK\u0003\u0004")) return true;
  if (TEXT_CONTENT_TYPE.test(contentType.trim())) return false;
  // Unknown or generic types (application/octet-stream): look at the bytes
  return head.includes(0);
}

function extractTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return undefined;
  return m[1].replace(/<[^>]+>/g, "").trim().slice(0, 200) || undefined;
}

function toVideoData(video: YouTubeVideo, startAt: number, maxChars: number): YouTubeVideoData {
  const slice = sliceTranscript(video.transcriptText, startAt, maxChars);
  return {
    kind: "video",
    videoId: video.videoId,
    title: video.title,
    channel: video.channel,
    channelUrl: video.channelUrl,
    uploadDate: video.uploadDate,
    duration: video.duration,
    durationSeconds: video.durationSeconds,
    viewCount: video.viewCount,
    likeCount: video.likeCount,
    isLive: video.isLive,
    thumbnail: video.thumbnail,
    chapters: video.chapters,
    tags: video.tags,
    // A continuation call only needs the transcript; the rest was in the first call
    description: startAt > 0 ? "" : video.description,
    transcript: video.transcript
      ? {
          ...video.transcript,
          text: slice.text,
          fromSeconds: slice.fromSeconds,
          nextStartAt: slice.nextStartAt,
          totalChars: video.transcriptText.length,
        }
      : null,
    savedFile: video.savedFile,
    fromSavedFile: video.cached,
  };
}

export const fetchUrlTool: ToolDefinition<FetchUrlParams, FetchUrlData> = {
  name: "fetch_url",
  description:
    "Fetches a public web page and returns its readable text content. Use to read documentation, articles, or any URL the user provides. SSRF-protected: private/loopback/internal IPs and localhost are blocked. Returns plain text (HTML tags stripped). " +
    "YouTube video URLs (youtube.com/watch, youtu.be, /shorts/, /live/) instead return `video`: title, channel, upload date, duration, views, description, chapters and the full transcript as `[m:ss] text` lines (one subtitle track; none when the video has no subtitles). Long transcripts come in parts: call again with the same URL and `startAt` = `video.transcript.nextStartAt`. Repeat calls for the same video are served from the saved copy on the server, not YouTube.",
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
        description:
          "Maximum characters of text to return (default 12000, max 40000; YouTube transcripts default to 40000).",
        default: MAX_CHARS_DEFAULT,
      },
      startAt: {
        type: "string",
        description:
          "YouTube only: where to read the transcript from, in seconds or 'm:ss' (use video.transcript.nextStartAt from the previous call).",
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

    // YouTube: metadata + transcript through yt-dlp; the page HTML is the fallback
    const videoId = extractYouTubeVideoId(url);
    if (videoId) {
      const maxVideoChars = Math.min(
        Math.max(Number(params?.maxChars) || MAX_CHARS_CAP, 2_000),
        MAX_CHARS_CAP
      );
      try {
        const video = await loadYouTubeVideo({
          videoId,
          sessionPublicId: context.sessionId,
          signal: context.signal,
        });
        const data = toVideoData(video, parseTimestamp(params?.startAt) ?? 0, maxVideoChars);
        if (context.sessionInternalId !== undefined) {
          void rememberFetchedVideo(context.sessionInternalId, {
            videoId: video.videoId,
            url: video.url,
            title: video.title,
            savedFile: video.savedFile,
            hasTranscript: Boolean(video.transcript),
          }).catch(() => {});
        }
        return {
          success: true,
          data: {
            url,
            finalUrl: video.url,
            status: 200,
            contentType: "video/youtube",
            title: video.title,
            text: data.transcript
              ? "YouTube video: metadata in `video`, transcript in `video.transcript.text`."
              : "YouTube video: metadata in `video`. This video has no subtitles, so there is no transcript.",
            truncated: Boolean(data.transcript?.nextStartAt),
            video: data,
          },
          metadata: { durationMs: Date.now() - startTime, provider: video.cached ? "yt-dlp-cache" : "yt-dlp" },
        };
      } catch (err) {
        if (context.signal?.aborted) throw err;
        if (!(err instanceof YtDlpError) && !(err instanceof SyntaxError)) throw err;
        console.warn(`[FETCH_URL_YTDLP] ${videoId}: ${err.message}`);
      }
    }

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

      // A PDF, image or archive decoded as text is noise for the model (and its NUL
      // bytes cannot be stored), so say what it is instead of returning it
      if (isBinaryBody(contentType, buffer)) {
        return {
          success: false,
          error: {
            code: "INVALID_PARAM",
            message: `The URL returned a binary file (${contentType.split(";")[0].trim()}), not a readable web page. Look for an HTML version of the page (e.g. the article page instead of its download link).`,
          },
          metadata: { durationMs: Date.now() - startTime },
        };
      }

      const raw = new TextDecoder("utf-8", { fatal: false }).decode(buffer).replace(/\u0000/g, "");
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
