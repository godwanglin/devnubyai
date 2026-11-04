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

function isSafeRelativeWorkspacePath(relPath: string): boolean {
  if (!relPath || relPath.includes("..") || relPath.includes("\0")) {
    return false;
  }
  const normalized = path.normalize(relPath);
  return !normalized.startsWith("..") && !path.isAbsolute(normalized);
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
      entry.name === "__pycache__" ||
      entry.name === "unpacked"
    ) {
      continue;
    }
    const fullPath = path.join(currentDir, entry.name);
    const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      const nested = await walkWorkspaceFiles(rootDir, fullPath);
      results.push(...nested);
    } else if (entry.isFile()) {
      const stat = await fs.stat(fullPath);
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
 * Creates an isolated temporary workspace directory, mounts session files from R2
 * (or inline JSON input files), and takes a pre-execution snapshot.
 */
export async function prepareExecutionWorkspace(options: {
  userId: string;
  sessionId: string;
  inputFiles?: Record<string, string>;
}): Promise<WorkspaceSnapshot> {
  const runId = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
  const workspaceDir = path.join(
    os.tmpdir(),
    `${EXECUTOR_CONFIG.tempDirPrefix}${runId}`
  );
  await fs.mkdir(workspaceDir, { recursive: true });

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
        try {
          const downloaded = await downloadFromR2({
            userId: options.userId,
            sessionId: options.sessionId,
            filename: sf.filename,
          });
          const cleanName = sf.filename.replace(/^\d+-[a-f0-9]+-/, "");
          if (isSafeRelativeWorkspacePath(cleanName)) {
            await fs.writeFile(path.join(workspaceDir, cleanName), downloaded.content);
          }
          if (
            sf.filename !== cleanName &&
            isSafeRelativeWorkspacePath(sf.filename)
          ) {
            await fs.writeFile(path.join(workspaceDir, sf.filename), downloaded.content);
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
      const dest = path.join(workspaceDir, cleanRel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, String(content ?? ""), "utf-8");
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
}): Promise<{
  generatedFiles: ExportedWorkspaceFile[];
  jsonOutputs: Record<string, unknown>;
}> {
  const { snapshot, userId, sessionId, syncToR2 = true } = options;
  const afterFiles = await walkWorkspaceFiles(snapshot.workspaceDir);
  const changed = afterFiles.filter((f) => {
    const prevMtime = snapshot.initialFileMap.get(f.relPath);
    return prevMtime === undefined || f.mtimeMs > prevMtime;
  });

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

  for (const file of changed.slice(0, EXECUTOR_CONFIG.maxGeneratedFiles)) {
    if (file.size <= 0 || file.size > EXECUTOR_CONFIG.maxWorkspaceFileBytes) {
      continue;
    }

    const buffer = await fs.readFile(file.fullPath);
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
