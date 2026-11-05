/**
 * YouTube URL detection for `fetch_url`.
 *
 * Only the 11-character video id is taken from the URL; yt-dlp is always called with a
 * canonical `https://www.youtube.com/watch?v=<id>` built from it, so nothing the model
 * writes in the URL ever reaches the yt-dlp command line.
 */

const YOUTUBE_HOST = /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtube-nocookie\.com)$/i;
const SHORT_HOST = /^youtu\.be$/i;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PATH_FORMS = /^\/(?:shorts|live|embed|v|e)\/([A-Za-z0-9_-]{11})(?:[/?#]|$)/;

/** The video id of a YouTube watch / shorts / live / embed / youtu.be URL, else null. */
export function extractYouTubeVideoId(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase();

  if (SHORT_HOST.test(host)) {
    const id = url.pathname.split("/")[1] ?? "";
    return VIDEO_ID.test(id) ? id : null;
  }
  if (!YOUTUBE_HOST.test(host)) return null;

  if (url.pathname === "/watch") {
    const id = url.searchParams.get("v") ?? "";
    return VIDEO_ID.test(id) ? id : null;
  }
  const match = PATH_FORMS.exec(url.pathname);
  return match ? match[1] : null;
}

export function canonicalYouTubeUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** Seconds as `m:ss`, or `h:mm:ss` from one hour. */
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** `90`, `"1:30"`, `"01:02:03"` → seconds; null when unparseable. */
export function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}
