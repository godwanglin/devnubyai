import fsPromises from "node:fs/promises";
import path from "node:path";
import { EXECUTOR_CONFIG, SANDBOX_CONFIG } from "./config";
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
