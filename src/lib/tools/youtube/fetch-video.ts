import { safeFetch } from "../ssrf";
import { canonicalYouTubeUrl, formatTimestamp } from "./detect";
import { buildTranscript } from "./transcript";
import { readCachedVideo, videoCacheRelativePath, writeCachedVideo, type CachedVideo } from "./video-cache";
import { runYtDlp } from "./ytdlp";

/**
 * Reads one YouTube video for `fetch_url`: title, description, metadata and the full
 * transcript with timestamps. yt-dlp only reads metadata (`--skip-download`); the one
 * chosen subtitle track is then fetched as text through the SSRF-guarded `safeFetch`.
 * No video or audio is ever downloaded.
 */

interface SubtitleTrack {
  ext?: string;
  url?: string;
}

interface YtDlpInfo {
  title?: string;
  channel?: string;
  uploader?: string;
  channel_url?: string;
  upload_date?: string;
  duration?: number;
  view_count?: number;
  like_count?: number;
  description?: string;
  thumbnail?: string;
  tags?: string[];
  is_live?: boolean;
  language?: string | null;
  chapters?: { start_time?: number; title?: string }[] | null;
  subtitles?: Record<string, SubtitleTrack[]>;
  automatic_captions?: Record<string, SubtitleTrack[]>;
}

const DESCRIPTION_CAP = 5_000;
const SUBTITLE_MAX_BYTES = 6 * 1024 * 1024;

/** Manual captions beat auto-captions; then the video's own language, Indonesian, English. */
function pickTrack(info: YtDlpInfo): { language: string; source: "manual" | "auto"; url: string } | null {
  const preference = [info.language, "id", "en"]
    .filter((l): l is string => Boolean(l))
    .map((l) => l.toLowerCase().split("-")[0]);
  const rank = (language: string): number => {
    const index = preference.indexOf(language.toLowerCase().split("-")[0]);
    return index === -1 ? preference.length : index;
  };
  const groups = [
    { source: "manual" as const, tracks: info.subtitles ?? {} },
    { source: "auto" as const, tracks: info.automatic_captions ?? {} },
  ];
  for (const group of groups) {
    const languages = Object.keys(group.tracks)
      .filter((l) => l !== "live_chat")
      // Auto-captions are machine-translated into every language: only the original counts
      .filter((l) => group.source === "manual" || l.endsWith("-orig") || rank(l) === 0)
      .sort((a, b) => rank(a) - rank(b));
    for (const language of languages) {
      // The timedtext URL returns the whole track; the HLS playlist variant does not
      const track = (group.tracks[language] ?? []).find(
        (t) => t.ext === "vtt" && t.url && /\/api\/timedtext\b/.test(t.url)
      );
      if (track?.url) return { language: language.replace(/-orig$/, ""), source: group.source, url: track.url };
    }
  }
  return null;
}

async function fetchSubtitle(url: string, signal?: AbortSignal): Promise<string> {
  const fetched = await safeFetch(url, { method: "GET", headers: { Accept: "text/vtt,*/*" }, signal });
  if ("blocked" in fetched || !fetched.response.ok) return "";
  const text = await fetched.response.text();
  return Buffer.byteLength(text, "utf8") > SUBTITLE_MAX_BYTES ? "" : text;
}

function formatUploadDate(raw: string | undefined): string | null {
  return raw && /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6)}` : null;
}

export interface YouTubeVideo extends CachedVideo {
  /** Project-relative path of the saved copy on the server */
  savedFile: string | null;
  /** True when served from the saved copy instead of YouTube */
  cached: boolean;
}

export async function loadYouTubeVideo(options: {
  videoId: string;
  sessionPublicId: string;
  signal?: AbortSignal;
}): Promise<YouTubeVideo> {
  const { videoId, sessionPublicId, signal } = options;
  const cached = await readCachedVideo(sessionPublicId, videoId);
  if (cached) {
    return { ...cached, savedFile: videoCacheRelativePath(sessionPublicId, videoId), cached: true };
  }

  const url = canonicalYouTubeUrl(videoId);
  const raw = await runYtDlp(
    ["-J", "--skip-download", "--no-warnings", "--no-playlist", "--ignore-config", "--socket-timeout", "20", "--", url],
    signal
  );
  const info = JSON.parse(raw) as YtDlpInfo;

  const track = info.is_live ? null : pickTrack(info);
  const vtt = track ? await fetchSubtitle(track.url, signal).catch(() => "") : "";
  const transcriptText = track && vtt.trim() ? buildTranscript(vtt, track.source === "auto") : "";

  const video: CachedVideo = {
    videoId,
    url,
    title: (info.title ?? "").trim() || url,
    channel: info.channel ?? info.uploader ?? null,
    channelUrl: info.channel_url ?? null,
    uploadDate: formatUploadDate(info.upload_date),
    durationSeconds: typeof info.duration === "number" ? info.duration : null,
    duration: typeof info.duration === "number" ? formatTimestamp(info.duration) : null,
    viewCount: typeof info.view_count === "number" ? info.view_count : null,
    likeCount: typeof info.like_count === "number" ? info.like_count : null,
    description: (info.description ?? "").trim().slice(0, DESCRIPTION_CAP),
    chapters: (info.chapters ?? [])
      .filter((c) => typeof c.start_time === "number" && c.title)
      .map((c) => ({ start: formatTimestamp(c.start_time as number), title: String(c.title) })),
    tags: (info.tags ?? []).slice(0, 15),
    thumbnail: info.thumbnail ?? null,
    isLive: Boolean(info.is_live),
    transcript: track && transcriptText ? { language: track.language, source: track.source } : null,
    transcriptText,
    fetchedAt: new Date().toISOString(),
  };

  const savedFile = await writeCachedVideo(sessionPublicId, video).catch(() => null);
  return { ...video, savedFile, cached: false };
}
