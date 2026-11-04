import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import {
  EXECUTOR_CONFIG,
  resolveSkillDirectory,
  resolveSkillScriptPath,
  SANDBOX_CONFIG,
} from "./config";
import { type CachedFontFamilyVariants, ensureFontsForExecution } from "./fonts";
import { ensureSkillPythonDependencies } from "./python-executor";
import { runInSandbox } from "./sandbox";
import { buildPythonRunnerSource, sanitizeSandboxOutput, validateSafeArgs } from "./security";
import type { SkillExecutionRequest, SkillExecutionResult, SkillScriptRuntime } from "./types";
import {
  acquireUserWorkspace,
  getSandboxSupport,
  WorkspaceError,
  withSessionRunLock,
} from "./user-workspace";
import { collectAndSyncWorkspaceOutputs, prepareExecutionWorkspace, writeFileNoFollow } from "./workspace";

const MAX_INLINE_CODE_CHARS = 120_000;
const RUNNER_FILES = ["_devnuby_py_runner.py", "_devnuby_inline_script.py", "_devnuby_inline_script.cjs"];

/** Host path inside a shared read-only dir -> the same file as seen from the sandbox. */
function toSandboxPath(hostPath: string, hostRoot: string, sandboxRoot: string): string {
  const rel = path.relative(hostRoot, hostPath).split(path.sep).join("/");
  return rel ? `${sandboxRoot}/${rel}` : sandboxRoot;
}

function remapFonts(fonts: CachedFontFamilyVariants[]): CachedFontFamilyVariants[] {
  const map = (p?: string) =>
    p ? toSandboxPath(p, EXECUTOR_CONFIG.fontsDir, SANDBOX_CONFIG.paths.fonts) : undefined;
  return fonts.map((f) => ({
    family: f.family,
    regular: map(f.regular),
    bold: map(f.bold),
    italic: map(f.italic),
    boldItalic: map(f.boldItalic),
  }));
}

/**
 * `run_skill_script` on hosts with the OS sandbox: same request/result shape as the
 * legacy in-process sandboxes, but the script runs as the restricted sandbox user in the
 * persistent per-chat workspace, without the static code bans or the audit hook, so
 * scripts may spawn tools (LibreOffice, pdftoppm), use the network and install packages.
 */
export async function executeSkillScriptInSandbox(
  request: SkillExecutionRequest,
  runtime: SkillScriptRuntime
): Promise<SkillExecutionResult> {
  const startWall = Date.now();
  const support = await getSandboxSupport();
  if (!support.ok) throw new WorkspaceError(`Command sandbox unavailable: ${support.reason}`);

  const args = validateSafeArgs(request.args);
  const inlineCode = request.code?.trim() ? request.code.trim() : undefined;
  if (inlineCode && inlineCode.length > MAX_INLINE_CODE_CHARS) {
    throw new Error(`Inline code exceeds maximum allowed length (${MAX_INLINE_CODE_CHARS} characters).`);
  }

  let skillName: string;
  let skillDir: string;
  let scriptName: string;
  let hostScriptPath: string | undefined;
  if (inlineCode) {
    ({ skillName, skillDir } = resolveSkillDirectory(request.skill));
    scriptName = request.script?.trim() || (runtime === "node" ? "inline_script.cjs" : "inline_script.py");
  } else {
    if (!request.script) {
      throw new Error("Either 'script' (helper filename in scripts/) or 'code' (inline code) must be provided.");
    }
    const resolved = resolveSkillScriptPath(request.skill, request.script, runtime);
    ({ skillName, skillDir, scriptName } = resolved);
    hostScriptPath = resolved.scriptFullPath;
  }

  const p = SANDBOX_CONFIG.paths;
  const sandboxSkillDir = toSandboxPath(skillDir, EXECUTOR_CONFIG.skillsRootDir, p.skills);
  const timeoutMs = Math.min(
    Math.max(request.timeoutMs ?? EXECUTOR_CONFIG.defaultTimeoutMs, 1_000),
    EXECUTOR_CONFIG.maxTimeoutMs
  );

  let cachedFonts: CachedFontFamilyVariants[] = [];
  if (runtime === "python") {
    const [, fonts] = await Promise.all([
      ensureSkillPythonDependencies(skillName, inlineCode),
      ensureFontsForExecution(inlineCode),
    ]);
    cachedFonts = remapFonts(fonts);
  }

  const owner = { uid: support.uid, gid: support.gid };
  const lease = await acquireUserWorkspace(request.userId, request.sessionId);
  try {
    return await withSessionRunLock(lease.userKey, lease.sessionKey, async () => {
      const snapshot = await prepareExecutionWorkspace({
        userId: request.userId,
        sessionId: request.sessionId,
        inputFiles: request.inputFiles,
        workspaceDir: lease.workspaceDir,
        owner,
      });

      try {
        let targetScript = hostScriptPath
          ? toSandboxPath(hostScriptPath, EXECUTOR_CONFIG.skillsRootDir, p.skills)
          : "";
        let argv: string[];
        let env: Record<string, string> | undefined;

        if (runtime === "node") {
          if (inlineCode) {
            await writeFileNoFollow(path.join(lease.workspaceDir, "_devnuby_inline_script.cjs"), inlineCode, owner);
            targetScript = `${p.workspace}/_devnuby_inline_script.cjs`;
          }
          argv = [fs.realpathSync(process.execPath), targetScript, ...args];
        } else {
          if (inlineCode) {
            await writeFileNoFollow(path.join(lease.workspaceDir, "_devnuby_inline_script.py"), inlineCode, owner);
            targetScript = `${p.workspace}/_devnuby_inline_script.py`;
          }
          const runnerSource = buildPythonRunnerSource({
            workspaceDir: p.workspace,
            skillDir: sandboxSkillDir,
            venvDir: p.venv,
            customFontsDir: p.fonts,
            projectRootDir: "/nonexistent",
            targetScriptPath: targetScript,
            cachedFonts,
            enforce: false,
          });
          await writeFileNoFollow(path.join(lease.workspaceDir, "_devnuby_py_runner.py"), runnerSource, owner);
          const python = fs.existsSync(EXECUTOR_CONFIG.pythonVenvDir) ? `${p.venv}/bin/python3` : "python3";
          argv = [python, "-B", `${p.workspace}/_devnuby_py_runner.py`, ...args];
          // Skill helper modules import each other from scripts/
          env = { PYTHONPATH: `${sandboxSkillDir}/scripts:${p.home}/.pylib` };
        }

        const outcome = await runInSandbox({ lease, argv, env, timeoutMs });

        const { generatedFiles, jsonOutputs } = await collectAndSyncWorkspaceOutputs({
          snapshot,
          userId: request.userId,
          sessionId: request.sessionId,
        });

        return {
          ok: !outcome.timedOut && outcome.exitCode === 0,
          runtime,
          exitCode: outcome.exitCode,
          timedOut: outcome.timedOut,
          skill: skillName,
          script: scriptName,
          args,
          stdout: sanitizeSandboxOutput(outcome.stdout, lease.workspaceDir),
          stderr: sanitizeSandboxOutput(outcome.stderr, lease.workspaceDir),
          durationMs: Date.now() - startWall,
          generatedFiles,
          jsonOutputs: Object.keys(jsonOutputs).length > 0 ? jsonOutputs : undefined,
        };
      } finally {
        for (const name of RUNNER_FILES) {
          await fsPromises.rm(path.join(lease.workspaceDir, name), { force: true }).catch(() => undefined);
        }
      }
    });
  } finally {
    lease.release();
  }
}
