import fs from "node:fs/promises";
import path from "node:path";
import { EXECUTOR_CONFIG } from "@/executors/config";
import { toWorkspaceKey } from "@/executors/user-workspace";

/**
 * On-disk copy of every YouTube video `fetch_url` has read, one JSON file per chat and
 * video: `.devnuby/fetch-cache/<chatId>/yt-<videoId>.json`. A repeat call (the model
 * reading on from a later timestamp, or a later turn) is served from here instead of
 * asking YouTube again. Files older than `CACHE_TTL_MS` are refetched and pruned.
 */

export interface CachedVideo {
  videoId: string;
  url: string;
  title: string;
  channel: string | null;
  channelUrl: string | null;
  uploadDate: string | null;
  durationSeconds: number | null;
  duration: string | null;
  viewCount: number | null;
  likeCount: number | null;
  description: string;
  chapters: { start: string; title: string }[];
  tags: string[];
  thumbnail: string | null;
  isLive: boolean;
  /** The one subtitle track used, or null when the video has none */
  transcript: { language: string; source: "manual" | "auto" } | null;
  /** Full `[m:ss] text` transcript; empty when there are no subtitles */
  transcriptText: string;
  fetchedAt: string;
}

const CACHE_ROOT = path.resolve(EXECUTOR_CONFIG.projectRootDir, ".devnuby", "fetch-cache");
const CACHE_TTL_MS = 7 * 24 * 60 * 60_000;
const PRUNE_INTERVAL_MS = 60 * 60_000;
let lastPruneAt = 0;

export function videoCacheFilename(videoId: string): string {
  return `yt-${videoId}.json`;
}

/** Project-relative path, as shown to the model and in session memory. */
export function videoCacheRelativePath(sessionPublicId: string, videoId: string): string {
  return `.devnuby/fetch-cache/${toWorkspaceKey(sessionPublicId)}/${videoCacheFilename(videoId)}`;
}

function cachePath(sessionPublicId: string, videoId: string): string {
  return path.join(CACHE_ROOT, toWorkspaceKey(sessionPublicId), videoCacheFilename(videoId));
}

export async function readCachedVideo(sessionPublicId: string, videoId: string): Promise<CachedVideo | null> {
  try {
    const file = cachePath(sessionPublicId, videoId);
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as CachedVideo;
    return parsed?.videoId === videoId ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeCachedVideo(sessionPublicId: string, video: CachedVideo): Promise<string> {
  const file = cachePath(sessionPublicId, video.videoId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(video, null, 2), "utf8");
  await fs.rename(tmp, file);
  void pruneVideoCache();
  return videoCacheRelativePath(sessionPublicId, video.videoId);
}

/** Drops cached videos past their TTL and the chat folders left empty, at most once an hour. */
async function pruneVideoCache(): Promise<void> {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  try {
    for (const dir of await fs.readdir(CACHE_ROOT)) {
      const dirPath = path.join(CACHE_ROOT, dir);
      const files = await fs.readdir(dirPath).catch(() => [] as string[]);
      let remaining = files.length;
      for (const name of files) {
        const filePath = path.join(dirPath, name);
        const stat = await fs.stat(filePath).catch(() => null);
        if (stat && now - stat.mtimeMs > CACHE_TTL_MS) {
          await fs.rm(filePath, { force: true }).catch(() => {});
          remaining -= 1;
        }
      }
      if (remaining === 0) await fs.rmdir(dirPath).catch(() => {});
    }
  } catch {
    // No cache yet
  }
}
