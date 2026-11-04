import { spawn } from "node:child_process";
import fsPromises from "node:fs/promises";
import path from "node:path";
import {
  buildSanitizedNodeEnv,
  EXECUTOR_CONFIG,
  resolveNodeExecutable,
  resolveSkillDirectory,
  resolveSkillScriptPath,
} from "./config";
import {
  prepareNodeSandbox,
  sanitizeSandboxOutput,
  validateInlineCodeSecurity,
  validateSafeArgs,
} from "./security";
import type {
  NodeSkillExecutionRequest,
  NodeSkillExecutionResult,
} from "./types";
import {
  cleanupExecutionWorkspace,
  collectAndSyncWorkspaceOutputs,
  prepareExecutionWorkspace,
} from "./workspace";

function appendCapped(current: string, chunk: Buffer, maxChars: number): string {
  if (current.length >= maxChars) return current;
  const text = chunk.toString("utf-8");
  const remaining = maxChars - current.length;
  if (text.length <= remaining) {
    return current + text;
  }
  return current + text.slice(0, remaining) + "\n...[output truncated]";
}

/**
 * Executes a Node.js skill script (e.g. `docx` or `pptxgenjs` document builders)
 * inside a hardened Node.js 24 `--permission` sandbox:
 * - Read access is strictly restricted to `workspaceDir`, `.devnuby/skills/<skill>`, and `node_modules`
 * - Write access is strictly restricted to `workspaceDir`
 * - Reading `.env`, `src/`, `prisma/`, `package.json`, or any host files outside workspace throws `ERR_ACCESS_DENIED`
 * - Spawning child processes, worker threads, or network connections is disabled
 */
export async function executeNodeSkillScript(
  request: NodeSkillExecutionRequest
): Promise<NodeSkillExecutionResult> {
  const startWall = Date.now();
  const args = validateSafeArgs(request.args);

  const hasInlineCode = Boolean(request.code && request.code.trim().length > 0);
  const validatedInlineCode = hasInlineCode
    ? validateInlineCodeSecurity(request.code!, "node")
    : undefined;

  let skillName: string;
  let skillDir: string;
  let scriptName: string;
  let resolvedScriptPath: string | undefined;

  if (hasInlineCode) {
    const resolvedSkill = resolveSkillDirectory(request.skill);
    skillName = resolvedSkill.skillName;
    skillDir = resolvedSkill.skillDir;
    scriptName = request.script?.trim() || "inline_script.cjs";
  } else {
    if (!request.script) {
      throw new Error(
        "Either 'script' (helper filename in scripts/) or 'code' (inline Node.js code) must be provided."
      );
    }
    const resolved = resolveSkillScriptPath(request.skill, request.script, "node");
    skillName = resolved.skillName;
    skillDir = resolved.skillDir;
    scriptName = resolved.scriptName;
    resolvedScriptPath = resolved.scriptFullPath;
  }

  const timeoutMs = Math.min(
    Math.max(request.timeoutMs ?? EXECUTOR_CONFIG.defaultTimeoutMs, 1_000),
    EXECUTOR_CONFIG.maxTimeoutMs
  );

  const snapshot = await prepareExecutionWorkspace({
    userId: request.userId,
    sessionId: request.sessionId,
    inputFiles: request.inputFiles,
  });

  const nodeBin = resolveNodeExecutable();
  const env = buildSanitizedNodeEnv(snapshot.workspaceDir);

  try {
    let targetScriptPath: string;
    if (validatedInlineCode) {
      targetScriptPath = path.join(
        snapshot.workspaceDir,
        "_devnuby_inline_script.cjs"
      );
      await fsPromises.writeFile(targetScriptPath, validatedInlineCode, "utf-8");
    } else {
      targetScriptPath = resolvedScriptPath!;
    }

    const { nodeFlags } = await prepareNodeSandbox({
      workspaceDir: snapshot.workspaceDir,
      skillDir,
      targetScriptPath,
      scriptArgs: args,
    });

    const runOutcome = await new Promise<{
      exitCode: number | null;
      timedOut: boolean;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;

      const child = spawn(nodeBin, nodeFlags, {
        cwd: snapshot.workspaceDir,
        env,
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      const timer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // Ignore kill error
        }
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout = appendCapped(stdout, chunk, EXECUTOR_CONFIG.maxOutputChars);
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = appendCapped(stderr, chunk, EXECUTOR_CONFIG.maxOutputChars);
      });

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode: 1,
          timedOut: false,
          stdout: stdout.trim(),
          stderr: `${stderr}\nFailed to launch Node.js sandbox (${nodeBin}): ${err.message}`.trim(),
        });
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode: code,
          timedOut,
          stdout: stdout.trim(),
          stderr: timedOut
            ? `${stderr}\nTimeoutError: Node.js skill script exceeded ${timeoutMs}ms limit.`.trim()
            : stderr.trim(),
        });
      });
    });

    const { generatedFiles, jsonOutputs } = await collectAndSyncWorkspaceOutputs({
      snapshot,
      userId: request.userId,
      sessionId: request.sessionId,
    });

    const ok = !runOutcome.timedOut && runOutcome.exitCode === 0;
    return {
      ok,
      runtime: "node",
      exitCode: runOutcome.exitCode,
      timedOut: runOutcome.timedOut,
      skill: skillName,
      script: scriptName,
      args,
      stdout: sanitizeSandboxOutput(runOutcome.stdout, snapshot.workspaceDir),
      stderr: sanitizeSandboxOutput(runOutcome.stderr, snapshot.workspaceDir),
      durationMs: Date.now() - startWall,
      generatedFiles,
      jsonOutputs: Object.keys(jsonOutputs).length > 0 ? jsonOutputs : undefined,
    };
  } finally {
    await cleanupExecutionWorkspace(snapshot.workspaceDir);
  }
}
