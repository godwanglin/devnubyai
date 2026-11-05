import fsPromises from "node:fs/promises";
import path from "node:path";
import type { LiveWorkspaceDocument } from "./types";

/** Document formats the files panel can preview while the script is still running. */
const LIVE_DOCUMENT_EXTENSIONS = new Set([
  ".pdf",
  ".docx",
  ".xlsx",
  ".pptx",
  ".html",
  ".htm",
  ".md",
  ".csv",
  ".svg",
]);

const POLL_INTERVAL_MS = 700;
// Top level only: the live reader opens files while the sandboxed script still runs, and
// with no directory in the path there is nothing it could swap for a symlink meanwhile
const MAX_SCAN_DEPTH = 1;
const MAX_ENTRIES_PER_SCAN = 400;

/**
 * Whether a workspace-relative path is a deliverable document that may be streamed to
 * the files panel: a known document extension, no `..`, and no scratch (`_part1.pdf`)
 * or hidden (`.cache`) segment.
 */
export function isLiveDocumentPath(relPath: string): boolean {
  const normalized = path.posix.normalize(relPath.replace(/\\/g, "/"));
  if (!normalized || normalized.startsWith("..") || path.posix.isAbsolute(normalized)) return false;
  const segments = normalized.split("/");
  if (segments.length > MAX_SCAN_DEPTH) return false;
  if (segments.some((s) => !s || s.startsWith("_") || s.startsWith("."))) return false;
  return LIVE_DOCUMENT_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase());
}

interface Observed {
  size: number;
  mtimeMs: number;
}

/**
 * Polls a running script's workspace and reports each document once its write has
 * settled (same size and mtime on two polls in a row), again after every rewrite.
 * Files untouched since the watch started (earlier deliverables) are ignored.
 */
export function watchWorkspaceDocuments(
  workspaceDir: string,
  onReady: (doc: LiveWorkspaceDocument) => void
): () => Promise<void> {
  const startedAt = Date.now() - 1_000;
  const lastSeen = new Map<string, Observed>();
  const lastEmitted = new Map<string, Observed>();
  let stopped = false;
  let scanning: Promise<void> | null = null;

  async function collect(dir: string, rel: string, depth: number, out: Map<string, Observed>) {
    if (depth > MAX_SCAN_DEPTH || out.size >= MAX_ENTRIES_PER_SCAN) return;
    const entries = await fsPromises
      .readdir(/* turbopackIgnore: true */ dir, { withFileTypes: true })
      .catch(() => []);
    for (const entry of entries) {
      if (out.size >= MAX_ENTRIES_PER_SCAN) return;
      if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childPath = path.join(dir, entry.name);
      // Dirent types come from lstat: symlinks are neither files nor directories here
      if (entry.isDirectory()) {
        await collect(childPath, childRel, depth + 1, out);
      } else if (entry.isFile() && isLiveDocumentPath(childRel)) {
        const stat = await fsPromises.lstat(childPath).catch(() => null);
        if (stat?.isFile() && stat.size > 0 && stat.mtimeMs >= startedAt) {
          out.set(childRel, { size: stat.size, mtimeMs: stat.mtimeMs });
        }
      }
    }
  }

  async function scan() {
    const current = new Map<string, Observed>();
    await collect(workspaceDir, "", 1, current);
    for (const [rel, now] of current) {
      const before = lastSeen.get(rel);
      const settled = before && before.size === now.size && before.mtimeMs === now.mtimeMs;
      const emitted = lastEmitted.get(rel);
      const isNew = !emitted || emitted.size !== now.size || emitted.mtimeMs !== now.mtimeMs;
      if (settled && isNew) {
        lastEmitted.set(rel, now);
        try {
          onReady({ path: rel, sizeBytes: now.size, version: Math.round(now.mtimeMs) });
        } catch {
          // A failing listener must not break the run
        }
      }
    }
    lastSeen.clear();
    for (const [rel, now] of current) lastSeen.set(rel, now);
  }

  function runScan(): Promise<void> {
    if (!scanning) {
      scanning = scan()
        .catch(() => undefined)
        .finally(() => {
          scanning = null;
        });
    }
    return scanning;
  }

  const timer = setInterval(() => {
    if (!stopped) void runScan();
  }, POLL_INTERVAL_MS);

  // No closing scan: once the script exits, the tool result carries the final files
  return async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    await scanning;
  };
}
