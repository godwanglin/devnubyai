import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";
import { BrowserFetchError, fetchWithBrowser } from "@/executors/lightpanda";
import { validateSafeUrl } from "./ssrf";
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

const TEXT_CONTENT_TYPE = /^(?:text\/|application\/(?:json|ld\+json|xml|xhtml\+xml|rss\+xml|atom\+xml|javascript)|image\/svg\+xml)/i;

/** The page's first heading, shown as the fetch label (`Opening <title>`). */
function markdownTitle(markdown: string): string | undefined {
  // Only an h1: reader mode often drops the page title, and a section heading would mislabel the page
  const m = /^#\s+(.+)$/m.exec(markdown);
  if (!m) return undefined;
  return m[1].replace(/[*_`]|\[([^\]]*)\]\([^)]*\)/g, "$1").trim().slice(0, 200) || undefined;
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
    "Opens a public web page in a headless browser (its JavaScript runs, so client-rendered sites work) and returns the main content as markdown, with headings, lists, tables and links kept. Use to read documentation, articles, or any URL the user provides. SSRF-protected: private/loopback/internal IPs and localhost are blocked. Sites behind a bot check (e.g. Cloudflare challenge) cannot be read. " +
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

    const fail = (code: "EXECUTION_ERROR" | "INVALID_PARAM" | "SSRF_BLOCKED", message: string) => ({
      success: false as const,
      error: { code, message },
      metadata: { durationMs: Date.now() - startTime },
    });

    // The literal host was checked above; the browser re-checks every request after DNS
    // (and the sandbox firewall drops internal addresses)
    try {
      const page = await fetchWithBrowser(url, context.signal);

      if (page.botChallenge) {
        return fail(
          "EXECUTION_ERROR",
          `The site answered with a bot check (${page.botChallenge}) instead of the page, so it cannot be read automatically.`
        );
      }
      if (page.status >= 400) return fail("EXECUTION_ERROR", `HTTP ${page.status}`);
      if (page.status === 0) return fail("EXECUTION_ERROR", "The site did not respond.");

      // A PDF, image or archive is not a readable page; say what it is
      const contentType = page.contentType;
      if (!TEXT_CONTENT_TYPE.test(contentType.trim())) {
        return fail(
          "INVALID_PARAM",
          `The URL returned a binary file (${contentType.split(";")[0].trim()}), not a readable web page. Look for an HTML version of the page (e.g. the article page instead of its download link).`
        );
      }

      const text = page.markdown.replace(/\u0000/g, "");
      if (!text) return fail("EXECUTION_ERROR", "The page loaded but has no readable text.");
      const truncated = text.length > maxChars;
      const finalText = truncated ? text.slice(0, maxChars) + "\n…[truncated]" : text;

      return {
        success: true,
        data: {
          url,
          finalUrl: page.url,
          status: page.status,
          contentType,
          title: markdownTitle(text),
          text: finalText,
          truncated,
        },
        metadata: { durationMs: Date.now() - startTime, provider: "lightpanda" },
      };
    } catch (err: unknown) {
      if (context.signal?.aborted) throw err;
      if (err instanceof BrowserFetchError) {
        return fail(err.code === "BLOCKED" ? "SSRF_BLOCKED" : "EXECUTION_ERROR", err.message);
      }
      const message = err instanceof Error ? err.message : "Fetch failed";
      return fail("EXECUTION_ERROR", `Failed to fetch URL: ${message}`);
    }
  },
};
