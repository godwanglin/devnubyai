import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { EXECUTOR_CONFIG, SANDBOX_CONFIG } from "./config";
import { isLiveDocumentPath } from "./live-documents";
import {
  acquireUserWorkspace,
  getSandboxSupport,
  hasUserWorkspace,
  withSessionRunLock,
} from "./user-workspace";
import { readFileNoFollow } from "./workspace";

export interface WorkspaceFileContent {
  /** Workspace-relative path, e.g. `_cek/page-1.png` */
  relPath: string;
  content: Buffer;
}

/**
 * Reads a file straight from the chat's sandbox workspace, so `read_file` can inspect
 * scratch output (previews, logs) that is never uploaded to session storage.
 * Returns null when there is no sandbox workspace or no such regular file. No path
 * component may be a symlink: the workspace is writable by sandboxed code.
 */
/**
 * Reads a top-level deliverable (`laporan.pdf`) from the chat's workspace while a script
 * may still be running there, for the live document preview. Unlike
 * `readSessionWorkspaceFile` it does not wait for the run lock; it is limited to files
 * directly in the workspace (no directory to race on) and opens them with O_NOFOLLOW and
 * O_NONBLOCK, so a symlink or FIFO planted by the script is refused rather than followed.
 */
export async function readLiveWorkspaceDocument(
  userId: string,
  sessionId: string,
  rawPath: string
): Promise<WorkspaceFileContent | null> {
  const rel = String(rawPath ?? "").trim();
  if (!isLiveDocumentPath(rel) || rel.includes("/") || rel.includes("\0")) return null;
  if (!(await getSandboxSupport()).ok || !hasUserWorkspace(userId)) return null;

  const lease = await acquireUserWorkspace(userId, sessionId);
  try {
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0);
    const handle = await fsPromises.open(path.join(lease.workspaceDir, rel), flags).catch(() => null);
    if (!handle) return null;
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > EXECUTOR_CONFIG.maxWorkspaceFileBytes) return null;
      return { relPath: rel, content: await handle.readFile() };
    } finally {
      await handle.close();
    }
  } finally {
    lease.release();
  }
}

export async function readSessionWorkspaceFile(
  userId: string,
  sessionId: string,
  rawPath: string
): Promise<WorkspaceFileContent | null> {
  let rel = String(rawPath ?? "").trim().replace(/\\/g, "/");
  const workspacePrefix = `${SANDBOX_CONFIG.paths.workspace}/`;
  if (rel.startsWith(workspacePrefix)) rel = rel.slice(workspacePrefix.length);
  rel = rel.replace(/^\.\//, "");
  if (!rel || rel.includes("\0") || path.posix.isAbsolute(rel)) return null;
  const normalized = path.posix.normalize(rel);
  if (normalized.startsWith("..")) return null;

  if (!(await getSandboxSupport()).ok || !hasUserWorkspace(userId)) return null;

  const lease = await acquireUserWorkspace(userId, sessionId);
  try {
    return await withSessionRunLock(lease.userKey, lease.sessionKey, async () => {
      const parts = normalized.split("/");
      let current = lease.workspaceDir;
      for (let i = 0; i < parts.length; i += 1) {
        current = path.join(current, parts[i]);
        const stat = await fsPromises.lstat(current).catch(() => null);
        if (!stat || stat.isSymbolicLink()) return null;
        const isLast = i === parts.length - 1;
        if (!isLast && !stat.isDirectory()) return null;
        if (isLast && (!stat.isFile() || stat.size > EXECUTOR_CONFIG.maxWorkspaceFileBytes)) return null;
      }
      const content = await readFileNoFollow(current).catch(() => null);
      return content ? { relPath: normalized, content } : null;
    });
  } finally {
    lease.release();
  }
}
