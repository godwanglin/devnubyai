import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "../lib/db";
import { getMimeTypeForFilename } from "../lib/files/policy";
import { checkAgentUploadQuota } from "../lib/files/upload-quota";
import { downloadFromR2, sanitizeKey, uploadToR2 } from "../lib/storage/r2";
import { EXECUTOR_CONFIG } from "./config";
import type { ExportedWorkspaceFile } from "./types";

export interface WorkspaceSnapshot {
  workspaceDir: string;
  initialFileMap: Map<string, number>; // relativePath -> mtimeMs
}

const INTERMEDIATE_DOC_PATTERN =
  /(?:^_|\b(?:part[_-]?\d+|bagian[_-]?\d+|draft|temp|tmp|raw)\b)/i;

export function isIntermediateWorkspaceDoc(filename: string): boolean {
  const base = path.basename(filename).replace(/^\d+-[a-f0-9]+-/, "");
  return (
    /\.(?:pdf|docx|dotx|xlsx|xlsm|pptx|potx)$/i.test(base) &&
    INTERMEDIATE_DOC_PATTERN.test(base)
  );
}

function isSafeRelativeWorkspacePath(relPath: string): boolean {
  if (!relPath || relPath.includes("..") || relPath.includes("\0")) {
    return false;
  }
  const normalized = path.normalize(relPath);
  return !normalized.startsWith("..") && !path.isAbsolute(normalized);
}

/** Dependency / cache folders that are never exported as deliverables. */
const SKIPPED_WORKSPACE_DIRS = new Set(["__pycache__", "unpacked", "node_modules", "venv", "site-packages"]);

export interface WorkspaceFileOwner {
  uid: number;
  gid: number;
}

/**
 * Writes a file without ever following a symlink at the destination. Persistent sandbox
 * workspaces are writable by sandboxed code, which could plant `report.pdf -> /etc/...`.
 */
export async function writeFileNoFollow(dest: string, content: string | Buffer, owner?: WorkspaceFileOwner): Promise<void> {
  const flags =
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW ?? 0);
  const handle = await fs.open(dest, flags, 0o644);
  try {
    await handle.writeFile(content);
    if (owner) await handle.chown(owner.uid, owner.gid);
  } finally {
    await handle.close();
  }
}

/** Reads a regular file without following a symlink at its final path component. */
async function readFileNoFollow(fullPath: string): Promise<Buffer | null> {
  const handle = await fs.open(fullPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    return stat.isFile() ? await handle.readFile() : null;
  } finally {
    await handle.close();
  }
}

async function walkWorkspaceFiles(
  rootDir: string,
  currentDir = rootDir
): Promise<Array<{ relPath: string; fullPath: string; mtimeMs: number; size: number }>> {
  const results: Array<{ relPath: string; fullPath: string; mtimeMs: number; size: number }> = [];
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name.startsWith(".") ||
      entry.name.startsWith("_devnuby_") ||
      SKIPPED_WORKSPACE_DIRS.has(entry.name)
    ) {
      continue;
    }
    const fullPath = path.join(currentDir, entry.name);
    const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      const nested = await walkWorkspaceFiles(rootDir, fullPath);
      results.push(...nested);
    } else if (entry.isFile()) {
      const stat = await fs.lstat(fullPath);
      results.push({
        relPath,
        fullPath,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
  }
  return results;
}

/**
 * Prepares the execution workspace, mounts session files from R2 (or inline JSON
 * input files), and takes a pre-execution snapshot.
 *
 * Without `workspaceDir` a fresh temporary directory is created. With it (the persistent
 * per-user sandbox workspace), files already present are kept as they are, so work in
 * progress survives between runs, and new files are handed to `owner`.
 */
export async function prepareExecutionWorkspace(options: {
  userId: string;
  sessionId: string;
  inputFiles?: Record<string, string>;
  workspaceDir?: string;
  owner?: WorkspaceFileOwner;
}): Promise<WorkspaceSnapshot> {
  const persistent = Boolean(options.workspaceDir);
  let workspaceDir: string;
  if (options.workspaceDir) {
    workspaceDir = options.workspaceDir;
  } else {
    const runId = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
    workspaceDir = path.join(os.tmpdir(), `${EXECUTOR_CONFIG.tempDirPrefix}${runId}`);
    await fs.mkdir(workspaceDir, { recursive: true });
  }

  const mountFile = async (relName: string, content: string | Buffer, overwrite: boolean) => {
    const dest = path.join(workspaceDir, relName);
    if (!overwrite && (await fs.lstat(dest).catch(() => null))) return;
    if (persistent) {
      // Persistent workspaces only take flat names; nested paths could traverse planted symlinks
      if (relName.includes("/")) return;
      await writeFileNoFollow(dest, content, options.owner);
      return;
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, content);
  };

  // 1. Download session files from R2 into workspace (both clean name & storage name)
  if (options.userId && options.sessionId) {
    try {
      const sessionFiles = await db.sessionFile.findMany({
        where: { session: { publicId: options.sessionId } },
        select: {
          publicId: true,
          filename: true,
          sizeBytes: true,
        },
      });

      for (const sf of sessionFiles) {
        if (Number(sf.sizeBytes) > EXECUTOR_CONFIG.maxWorkspaceFileBytes) continue;
        const cleanName = sf.filename.replace(/^\d+-[a-f0-9]+-/, "");
        // Persistent workspace already holds this file (possibly a newer local edit)
        if (persistent && (await fs.lstat(path.join(workspaceDir, cleanName)).catch(() => null))) {
          continue;
        }
        try {
          const downloaded = await downloadFromR2({
            userId: options.userId,
            sessionId: options.sessionId,
            filename: sf.filename,
          });
          if (isSafeRelativeWorkspacePath(cleanName)) {
            await mountFile(cleanName, downloaded.content, true);
            // If an image was saved as .jpg/.png.jpg while scripts reference .png (or vice versa),
            // mount convenience aliases so PIL / ReportLab ImageReader("foo.png") always succeeds.
            if (/\.(?:png|jpe?g|webp)$/i.test(cleanName)) {
              const baseStem = cleanName
                .replace(/\.(?:png|jpe?g|webp)$/i, "")
                .replace(/\.(?:png|jpe?g|webp)$/i, "");
              for (const aliasExt of ["png", "jpg"]) {
                const aliasName = `${baseStem}.${aliasExt}`;
                if (aliasName !== cleanName && isSafeRelativeWorkspacePath(aliasName)) {
                  await mountFile(aliasName, downloaded.content, false);
                }
              }
            }
          }
          if (
            sf.filename !== cleanName &&
            isSafeRelativeWorkspacePath(sf.filename)
          ) {
            await mountFile(sf.filename, downloaded.content, false);
          }
        } catch {
          // Skip unreadable storage file without failing the workspace mount
        }
      }
    } catch {
      // Non-fatal in unit test contexts without DB/R2
    }
  }

  // 2. Write any inline inputFiles (e.g. field_values.json, fields.json)
  if (options.inputFiles) {
    for (const [rawName, content] of Object.entries(options.inputFiles)) {
      const cleanRel = rawName.trim().replace(/\\/g, "/");
      if (!isSafeRelativeWorkspacePath(cleanRel)) continue;
      await mountFile(cleanRel, String(content ?? ""), true);
    }
  }

  // 3. Snapshot all pre-existing files so we only export newly generated or modified files
  const existing = await walkWorkspaceFiles(workspaceDir);
  const initialFileMap = new Map<string, number>();
  for (const item of existing) {
    initialFileMap.set(item.relPath, item.mtimeMs);
  }

  return { workspaceDir, initialFileMap };
}

/**
 * Collects files created or modified during script execution, parses any JSON outputs,
 * and uploads generated binary/text artifacts back to R2 session storage.
 */
export async function collectAndSyncWorkspaceOutputs(options: {
  snapshot: WorkspaceSnapshot;
  userId: string;
  sessionId: string;
  syncToR2?: boolean;
  /** Only export changed files this predicate accepts (default: all changed files) */
  include?: (relPath: string) => boolean;
  /** Per-file export size limit (default: `EXECUTOR_CONFIG.maxWorkspaceFileBytes`) */
  maxFileBytes?: number;
  /** Remove session files whose workspace copy was deleted during the run (default: true) */
  syncDeletions?: boolean;
}): Promise<{
  generatedFiles: ExportedWorkspaceFile[];
  jsonOutputs: Record<string, unknown>;
}> {
  const { snapshot, userId, sessionId, syncToR2 = true, syncDeletions = true } = options;
  const maxFileBytes = options.maxFileBytes ?? EXECUTOR_CONFIG.maxWorkspaceFileBytes;
  const afterFiles = await walkWorkspaceFiles(snapshot.workspaceDir);
  const afterRelSet = new Set(afterFiles.map((f) => f.relPath));

  const changed = afterFiles.filter((f) => {
    const prevMtime = snapshot.initialFileMap.get(f.relPath);
    const isChanged = prevMtime === undefined || f.mtimeMs > prevMtime;
    return isChanged && (!options.include || options.include(f.relPath));
  });

  // Track files that existed before the script ran and were explicitly removed (e.g. os.remove("_part1.pdf"))
  const deletedRelPaths: string[] = [];
  if (syncDeletions) {
    for (const initRel of snapshot.initialFileMap.keys()) {
      if (!afterRelSet.has(initRel)) {
        deletedRelPaths.push(initRel);
      }
    }
  }

  const generatedFiles: ExportedWorkspaceFile[] = [];
  const jsonOutputs: Record<string, unknown> = {};

  let sessionRow: { id: bigint; publicId: string; userId: bigint } | null = null;
  if (syncToR2 && userId && sessionId) {
    try {
      sessionRow = await db.chatSession.findUnique({
        where: { publicId: sessionId },
        select: { id: true, publicId: true, userId: true },
      });
    } catch {
      sessionRow = null;
    }
  }

  const producedFinalDeliverableDoc = changed.some((f) => {
    const flat = sanitizeKey(f.relPath.replace(/\//g, "_"));
    return (
      /\.(?:pdf|docx|dotx|xlsx|xlsm|pptx|potx)$/i.test(flat) &&
      !isIntermediateWorkspaceDoc(flat)
    );
  });

  for (const file of changed.slice(0, EXECUTOR_CONFIG.maxGeneratedFiles)) {
    if (file.size <= 0 || file.size > maxFileBytes) {
      continue;
    }

    const buffer = await readFileNoFollow(file.fullPath).catch(() => null);
    if (!buffer) continue;
    const flatDisplayName = sanitizeKey(file.relPath.replace(/\//g, "_"));
    const mimeType = getMimeTypeForFilename(flatDisplayName);

    // If it's a JSON output file (e.g. field_info.json, form_structure.json), parse it for the AI
    if (flatDisplayName.toLowerCase().endsWith(".json") && file.size <= 512 * 1024) {
      try {
        jsonOutputs[file.relPath] = JSON.parse(buffer.toString("utf-8"));
      } catch {
        // Ignore invalid JSON
      }
    }

    // If the same script already produced the final merged document alongside a raw _part* file,
    // skip syncing the raw _part* file so only the final deliverable is exported.
    if (producedFinalDeliverableDoc && isIntermediateWorkspaceDoc(flatDisplayName)) {
      continue;
    }

    if (syncToR2 && sessionRow) {
      try {
        const quotaError = await checkAgentUploadQuota(userId, buffer.length);
        if (quotaError) continue;

        const uploaded = await uploadToR2({
          userId,
          sessionId,
          filename: flatDisplayName,
          content: buffer,
          contentType: mimeType,
        });

        const savedFile = await db.sessionFile.upsert({
          where: {
            sessionId_filename: {
              sessionId: sessionRow.id,
              filename: uploaded.filename,
            },
          },
          update: {
            storageKey: uploaded.key,
            mimeType: uploaded.contentType,
            sizeBytes: BigInt(uploaded.sizeBytes),
            source: "tool",
          },
          create: {
            userId: sessionRow.userId,
            sessionId: sessionRow.id,
            filename: uploaded.filename,
            storageKey: uploaded.key,
            mimeType: uploaded.contentType,
            sizeBytes: BigInt(uploaded.sizeBytes),
            source: "tool",
          },
          select: { publicId: true },
        });

        generatedFiles.push({
          id: savedFile.publicId,
          key: uploaded.key,
          filename: uploaded.filename,
          displayName: flatDisplayName,
          mimeType: uploaded.contentType,
          sizeBytes: uploaded.sizeBytes,
          url: `/api/v1/chats/${sessionRow.publicId}/files/${savedFile.publicId}`,
        });
        continue;
      } catch {
        // Fallback to local metadata record if R2 is not configured in local test
      }
    }

    generatedFiles.push({
      key: flatDisplayName,
      filename: flatDisplayName,
      displayName: flatDisplayName,
      mimeType,
      sizeBytes: buffer.length,
      url: "",
    });
  }

  // Clean up any explicitly deleted files or intermediate partial documents from session_files
  // once the final merged deliverable document has been created.
  if (syncToR2 && sessionRow && (deletedRelPaths.length > 0 || producedFinalDeliverableDoc)) {
    try {
      const existingSessionFiles = await db.sessionFile.findMany({
        where: { sessionId: sessionRow.id, source: "tool" },
        select: { id: true, filename: true },
      });
      const deletedSet = new Set(deletedRelPaths.map((p) => sanitizeKey(p.replace(/\//g, "_"))));
      const idsToDelete: bigint[] = [];
      for (const sf of existingSessionFiles) {
        const cleanName = sf.filename.replace(/^\d+-[a-f0-9]+-/, "");
        if (
          deletedSet.has(sf.filename) ||
          deletedSet.has(cleanName) ||
          (producedFinalDeliverableDoc && isIntermediateWorkspaceDoc(cleanName))
        ) {
          idsToDelete.push(sf.id);
        }
      }
      if (idsToDelete.length > 0) {
        await db.sessionFile.deleteMany({
          where: { id: { in: idsToDelete } },
        });
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  return { generatedFiles, jsonOutputs };
}

/**
 * Safely deletes the ephemeral workspace directory.
 */
export async function cleanupExecutionWorkspace(workspaceDir: string): Promise<void> {
  if (!workspaceDir || !workspaceDir.includes(EXECUTOR_CONFIG.tempDirPrefix)) {
    return;
  }
  try {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}
