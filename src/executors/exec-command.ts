import path from "node:path";
import { SANDBOX_CONFIG } from "./config";
import { runInSandbox } from "./sandbox";
import { sanitizeSandboxOutput } from "./security";
import type { ExportedWorkspaceFile } from "./types";
import {
  acquireUserWorkspace,
  getSandboxSupport,
  getWorkspaceUsage,
  WorkspaceError,
  withSessionRunLock,
} from "./user-workspace";
import { collectAndSyncWorkspaceOutputs, prepareExecutionWorkspace } from "./workspace";

const MAX_COMMAND_CHARS = 20_000;
const MAX_PUBLISH_ENTRIES = 20;

/** Changed files with these extensions are shown to the user without being listed in `publish`. */
const AUTO_PUBLISH_EXTENSIONS = new Set([
  "pdf", "docx", "doc", "dotx", "odt", "rtf", "epub",
  "xlsx", "xlsm", "xls", "ods", "csv",
  "pptx", "ppt", "potx", "odp",
  "png", "jpg", "jpeg", "webp", "gif", "svg",
  "mp3", "wav", "ogg", "m4a", "mp4", "webm",
  "zip",
]);

export interface ExecCommandRequest {
  command: string;
  userId: string;
  sessionId: string;
  timeoutMs?: number;
  /** Workspace-relative paths to export even when their extension is not auto-published */
  publish?: string[];
  signal?: AbortSignal;
}

export interface ExecCommandResult {
  ok: boolean;
  exitCode: number | null;
  timedOut: boolean;
  command: string;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** New or modified deliverables uploaded to session storage */
  generatedFiles: ExportedWorkspaceFile[];
  workspace: {
    cwd: string;
    usedBytes: number;
    freeBytes: number;
    quotaBytes: number;
  };
}

/** Whether `exec_command` can run on this host. */
export async function isExecCommandAvailable(): Promise<boolean> {
  return (await getSandboxSupport()).ok;
}

function normalizePublishPath(raw: string): string | null {
  let rel = String(raw ?? "").trim().replace(/\\/g, "/");
  const workspacePrefix = `${SANDBOX_CONFIG.paths.workspace}/`;
  if (rel.startsWith(workspacePrefix)) rel = rel.slice(workspacePrefix.length);
  rel = rel.replace(/^\.\//, "");
  if (!rel || rel.includes("\0") || path.posix.isAbsolute(rel)) return null;
  const normalized = path.posix.normalize(rel);
  return normalized.startsWith("..") ? null : normalized;
}

/**
 * Runs an arbitrary shell command for the AI inside the OS sandbox, in the user's
 * persistent per-chat workspace, then exports new or changed deliverables to R2.
 */
export async function executeSandboxCommand(request: ExecCommandRequest): Promise<ExecCommandResult> {
  const startWall = Date.now();
  const command = String(request.command ?? "").trim();
  if (!command) throw new WorkspaceError("Parameter 'command' cannot be empty.");
  if (command.length > MAX_COMMAND_CHARS) {
    throw new WorkspaceError(`Command exceeds the maximum length of ${MAX_COMMAND_CHARS} characters.`);
  }

  const support = await getSandboxSupport();
  if (!support.ok) throw new WorkspaceError(`Command sandbox unavailable: ${support.reason}`);

  const timeoutMs = Math.min(
    Math.max(request.timeoutMs ?? SANDBOX_CONFIG.defaultTimeoutMs, 1_000),
    SANDBOX_CONFIG.maxTimeoutMs
  );
  const publish = new Set(
    (request.publish ?? [])
      .slice(0, MAX_PUBLISH_ENTRIES)
      .map(normalizePublishPath)
      .filter((p): p is string => Boolean(p))
  );
  const include = (relPath: string) => {
    if (publish.has(relPath)) return true;
    // `_scratch.png`, `_cek/page-1.png`: working files, not deliverables
    if (relPath.split("/").some((segment) => segment.startsWith("_"))) return false;
    const ext = path.posix.extname(relPath).slice(1).toLowerCase();
    return AUTO_PUBLISH_EXTENSIONS.has(ext);
  };

  const lease = await acquireUserWorkspace(request.userId, request.sessionId);
  try {
    return await withSessionRunLock(lease.userKey, lease.sessionKey, async () => {
      const snapshot = await prepareExecutionWorkspace({
        userId: request.userId,
        sessionId: request.sessionId,
        workspaceDir: lease.workspaceDir,
        owner: { uid: support.uid, gid: support.gid },
      });

      const outcome = await runInSandbox({
        lease,
        argv: ["/bin/bash", "-c", command],
        timeoutMs,
        signal: request.signal,
      });

      const { generatedFiles } = await collectAndSyncWorkspaceOutputs({
        snapshot,
        userId: request.userId,
        sessionId: request.sessionId,
        include,
        maxFileBytes: SANDBOX_CONFIG.maxPublishedFileBytes,
        // Cleaning up the workspace (rm) must not delete files the user already received
        syncDeletions: false,
      });

      const usage = await getWorkspaceUsage(lease.mountDir);
      return {
        ok: !outcome.timedOut && !outcome.aborted && outcome.exitCode === 0,
        exitCode: outcome.exitCode,
        timedOut: outcome.timedOut,
        command,
        stdout: sanitizeSandboxOutput(outcome.stdout, lease.workspaceDir),
        stderr: sanitizeSandboxOutput(outcome.stderr, lease.workspaceDir),
        durationMs: Date.now() - startWall,
        generatedFiles,
        workspace: { cwd: SANDBOX_CONFIG.paths.workspace, ...usage },
      };
    });
  } finally {
    lease.release();
  }
}
