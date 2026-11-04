import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildSanitizedPythonEnv,
  EXECUTOR_CONFIG,
  resolvePythonExecutable,
  resolveSkillDirectory,
  resolveSkillScriptPath,
} from "./config";
import { ensureFontsForExecution } from "./fonts";
import {
  sanitizeSandboxOutput,
  validateInlineCodeSecurity,
  validateSafeArgs,
  writePythonSandboxRunner,
} from "./security";
import type {
  PythonSkillExecutionRequest,
  PythonSkillExecutionResult,
} from "./types";
import {
  cleanupExecutionWorkspace,
  collectAndSyncWorkspaceOutputs,
  prepareExecutionWorkspace,
} from "./workspace";

const inFlightDepInstalls = new Map<string, Promise<void>>();

function appendCapped(current: string, chunk: Buffer, maxChars: number): string {
  if (current.length >= maxChars) return current;
  const text = chunk.toString("utf-8");
  const remaining = maxChars - current.length;
  if (text.length <= remaining) {
    return current + text;
  }
  return current + text.slice(0, remaining) + "\n...[output truncated]";
}

function runCommandSimple(
  cmd: string,
  args: string[],
  timeoutMs = 120_000
): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    let stderr = "";
    let settled = false;
    const child = spawn(cmd, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve({ ok: false, stderr: `Timed out after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk, 8_000);
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, stderr: err.message });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, stderr: stderr.trim() });
    });
  });
}

const PYPI_IMPORT_ALIAS_MAP: Record<string, string> = {
  PIL: "Pillow",
  cv2: "opencv-python-headless",
  sklearn: "scikit-learn",
  bs4: "beautifulsoup4",
  yaml: "PyYAML",
  fitz: "PyMuPDF",
  docx: "python-docx",
  pptx: "python-pptx",
  openpyxl: "openpyxl",
  xlsxwriter: "XlsxWriter",
  pandas: "pandas",
  numpy: "numpy",
  matplotlib: "matplotlib",
  scipy: "scipy",
  pypdf: "pypdf",
  pdfplumber: "pdfplumber",
  reportlab: "reportlab",
  pypdfium2: "pypdfium2",
  pdf2image: "pdf2image",
  pytesseract: "pytesseract",
  lxml: "lxml",
  defusedxml: "defusedxml",
};

function extractInferredPackagesFromSource(src: string): string[] {
  const packages = new Set<string>();
  const importRegex = /^\s*(?:import|from)\s+([a-zA-Z0-9_]+)/gm;
  let match: RegExpExecArray | null;
  while ((match = importRegex.exec(src)) !== null) {
    const modName = match[1];
    const mapped = PYPI_IMPORT_ALIAS_MAP[modName];
    if (mapped) {
      packages.add(mapped);
    }
  }
  return Array.from(packages);
}

async function collectPyFilesRecursively(dir: string): Promise<string[]> {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const entries = await fsPromises.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith(".") || e.name === "__pycache__") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await collectPyFilesRecursively(full)));
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".py")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Scans `.py` files in `.devnuby/skills/<skill>/scripts/` for known third-party imports
 * so even raw copy-pasted skills without a `requirements.txt` work automatically.
 */
async function inferRequirementsFromScripts(
  skillDir: string,
  extraInlineSource?: string
): Promise<string[]> {
  const scriptsDir = path.join(skillDir, "scripts");
  const pyFiles = await collectPyFilesRecursively(scriptsDir);
  const packages = new Set<string>();

  for (const file of pyFiles) {
    try {
      const src = await fsPromises.readFile(file, "utf-8");
      for (const pkg of extractInferredPackagesFromSource(src)) {
        packages.add(pkg);
      }
    } catch {
      // ignore unreadable file
    }
  }
  if (extraInlineSource) {
    for (const pkg of extractInferredPackagesFromSource(extraInlineSource)) {
      packages.add(pkg);
    }
  }
  return Array.from(packages).sort();
}

/**
 * Automatically ensures `.devnuby/.venv` exists and installs packages required by
 * `.devnuby/skills/<skill>/requirements.txt` AND any known imports in `scripts/` or inline code.
 * Uses SHA-256 stamp caching in `.devnuby/.venv/.deps-<skill>.sha256` so subsequent runs have zero overhead.
 */
export async function ensureSkillPythonDependencies(
  skillName: string,
  extraInlineSource?: string
): Promise<void> {
  const skillDir = path.join(EXECUTOR_CONFIG.skillsRootDir, skillName);
  const reqFile = path.join(skillDir, "requirements.txt");

  const explicitLines: string[] = [];
  if (fs.existsSync(reqFile)) {
    const rawReq = (await fsPromises.readFile(reqFile, "utf-8")).trim();
    if (rawReq) {
      for (const line of rawReq.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          explicitLines.push(trimmed);
        }
      }
    }
  }

  const inferredPkgs = await inferRequirementsFromScripts(
    skillDir,
    extraInlineSource
  );
  const combinedSpecs = Array.from(
    new Set([...explicitLines, ...inferredPkgs])
  ).sort();
  if (combinedSpecs.length === 0) {
    return;
  }

  const reqSignature = combinedSpecs.join("\n");
  const reqHash = crypto
    .createHash("sha256")
    .update(reqSignature)
    .digest("hex");
  const stampFile = path.join(
    EXECUTOR_CONFIG.pythonVenvDir,
    `.deps-${skillName}-${reqHash.slice(0, 12)}.sha256`
  );

  try {
    const existingHash = (await fsPromises.readFile(stampFile, "utf-8")).trim();
    if (existingHash === reqHash) {
      return;
    }
  } catch {
    // Stamp does not exist yet
  }

  const lockKey = `${skillName}:${reqHash}`;
  const existingPromise = inFlightDepInstalls.get(lockKey);
  if (existingPromise) {
    return existingPromise;
  }

  const installTask = (async () => {
    const isWin = os.platform() === "win32";
    const venvPython = isWin
      ? path.join(EXECUTOR_CONFIG.pythonVenvDir, "Scripts", "python.exe")
      : path.join(EXECUTOR_CONFIG.pythonVenvDir, "bin", "python");

    if (!fs.existsSync(venvPython)) {
      const sysPython = isWin ? "python" : "python3";
      await fsPromises.mkdir(path.dirname(EXECUTOR_CONFIG.pythonVenvDir), {
        recursive: true,
      });
      const venvRes = await runCommandSimple(sysPython, [
        "-m",
        "venv",
        EXECUTOR_CONFIG.pythonVenvDir,
      ]);
      if (!venvRes.ok) {
        throw new Error(
          `Failed to initialize Python venv at ${EXECUTOR_CONFIG.pythonVenvDir}: ${venvRes.stderr}`
        );
      }
    }

    const pipRes = await runCommandSimple(venvPython, [
      "-m",
      "pip",
      "install",
      "-q",
      "--disable-pip-version-check",
      ...combinedSpecs,
    ]);
    if (!pipRes.ok) {
      throw new Error(
        `Failed to install Python requirements for skill '${skillName}': ${pipRes.stderr}`
      );
    }

    await fsPromises.writeFile(stampFile, reqHash, "utf-8");
  })();

  inFlightDepInstalls.set(lockKey, installTask);
  try {
    await installTask;
  } finally {
    inFlightDepInstalls.delete(lockKey);
  }
}

/**
 * Executes either a pre-existing Python script inside `.devnuby/skills/<skill>/scripts/<script>.py`
 * OR an inline Python script (`code`) inside a hardened CPython `sys.addaudithook` sandbox
 * with R2 file synchronization, per-skill dependency auto-sync, sanitized env, and hard timeout protection.
 */
export async function executePythonSkillScript(
  request: PythonSkillExecutionRequest
): Promise<PythonSkillExecutionResult> {
  const startWall = Date.now();
  const args = validateSafeArgs(request.args);

  const hasInlineCode = Boolean(request.code && request.code.trim().length > 0);
  const validatedInlineCode = hasInlineCode
    ? validateInlineCodeSecurity(request.code!, "python")
    : undefined;

  let skillName: string;
  let skillDir: string;
  let skillScriptsDir: string;
  let scriptName: string;
  let resolvedScriptPath: string | undefined;

  if (hasInlineCode) {
    const resolvedSkill = resolveSkillDirectory(request.skill);
    skillName = resolvedSkill.skillName;
    skillDir = resolvedSkill.skillDir;
    skillScriptsDir = resolvedSkill.skillScriptsDir;
    scriptName = request.script?.trim() || "inline_script.py";
  } else {
    if (!request.script) {
      throw new Error(
        "Either 'script' (helper filename in scripts/) or 'code' (inline Python code) must be provided."
      );
    }
    const resolved = resolveSkillScriptPath(request.skill, request.script, "python");
    skillName = resolved.skillName;
    skillDir = resolved.skillDir;
    skillScriptsDir = resolved.skillScriptsDir;
    scriptName = resolved.scriptName;
    resolvedScriptPath = resolved.scriptFullPath;
  }

  // Auto-sync per-skill requirements.txt + inferred imports into .devnuby/.venv,
  // and auto-download any requested Google Fonts (e.g. "Lexend Deca") into .devnuby/fonts/
  const [, cachedFonts] = await Promise.all([
    ensureSkillPythonDependencies(skillName, validatedInlineCode),
    ensureFontsForExecution(validatedInlineCode),
  ]);

  const timeoutMs = Math.min(
    Math.max(request.timeoutMs ?? EXECUTOR_CONFIG.defaultTimeoutMs, 1_000),
    EXECUTOR_CONFIG.maxTimeoutMs
  );

  const snapshot = await prepareExecutionWorkspace({
    userId: request.userId,
    sessionId: request.sessionId,
    inputFiles: request.inputFiles,
  });

  const pythonBin = resolvePythonExecutable();
  const env = buildSanitizedPythonEnv(snapshot.workspaceDir, skillScriptsDir);

  try {
    let targetScriptPath: string;
    if (validatedInlineCode) {
      targetScriptPath = path.join(
        snapshot.workspaceDir,
        "_devnuby_inline_script.py"
      );
      await fsPromises.writeFile(targetScriptPath, validatedInlineCode, "utf-8");
    } else {
      targetScriptPath = resolvedScriptPath!;
    }

    // Wrap execution in the un-bypassable CPython sys.addaudithook sandbox runner
    const sandboxRunnerPath = await writePythonSandboxRunner({
      workspaceDir: snapshot.workspaceDir,
      skillDir,
      targetScriptPath,
      cachedFonts,
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

      const child = spawn(
        pythonBin,
        ["-s", "-B", sandboxRunnerPath, ...args],
        {
          cwd: snapshot.workspaceDir,
          env,
          shell: false,
          windowsHide: true,
          stdio: ["ignore", "pipe", "pipe"],
        }
      );

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
          stderr: `${stderr}\nFailed to launch Python process (${pythonBin}): ${err.message}`.trim(),
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
            ? `${stderr}\nTimeoutError: Python skill script exceeded ${timeoutMs}ms limit.`.trim()
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
      runtime: "python",
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
