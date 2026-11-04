import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExecutorConfig, SkillScriptRuntime } from "./types";

// turbopackIgnore: these are runtime paths, not files to bundle. Without it the build
// traces `.devnuby/.venv`, whose `bin/python` symlink points outside the project
// (to the system interpreter) and fails the production build.
const PROJECT_ROOT = path.resolve(/* turbopackIgnore: true */ process.cwd());
const SKILLS_ROOT_DIR = path.resolve(PROJECT_ROOT, ".devnuby", "skills");
const PYTHON_VENV_DIR = path.resolve(PROJECT_ROOT, ".devnuby", ".venv");
const FONTS_DIR = path.resolve(PROJECT_ROOT, ".devnuby", "fonts");
const NODE_MODULES_DIR = path.resolve(PROJECT_ROOT, "node_modules");

export const EXECUTOR_CONFIG: ExecutorConfig = {
  projectRootDir: PROJECT_ROOT,
  skillsRootDir: SKILLS_ROOT_DIR,
  pythonVenvDir: PYTHON_VENV_DIR,
  fontsDir: FONTS_DIR,
  nodeModulesDir: NODE_MODULES_DIR,
  tempDirPrefix: "devnuby-exec-",
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 60_000,
  maxOutputChars: 32_000,
  maxWorkspaceFileBytes: 15 * 1024 * 1024, // 15 MB
  maxGeneratedFiles: 20,
  allowedPythonExtensions: [".py"],
  allowedNodeExtensions: [".js", ".cjs", ".mjs"],
};

/**
 * Resolves the Python executable path.
 * Prioritizes:
 * 1. `DEVNUBY_PYTHON_BIN` env variable if explicitly configured
 * 2. `.devnuby/.venv` virtual environment (`Scripts/python.exe` on Windows, `bin/python` on POSIX)
 * 3. System `python` / `python3`
 */
export function resolvePythonExecutable(): string {
  const customBin = process.env.DEVNUBY_PYTHON_BIN?.trim();
  if (customBin && fs.existsSync(customBin)) {
    return customBin;
  }

  const isWin = os.platform() === "win32";
  const venvCandidates = isWin
    ? [
        path.join(EXECUTOR_CONFIG.pythonVenvDir, "Scripts", "python.exe"),
        path.join(PROJECT_ROOT, ".venv", "Scripts", "python.exe"),
      ]
    : [
        path.join(EXECUTOR_CONFIG.pythonVenvDir, "bin", "python3"),
        path.join(EXECUTOR_CONFIG.pythonVenvDir, "bin", "python"),
        path.join(PROJECT_ROOT, ".venv", "bin", "python3"),
        path.join(PROJECT_ROOT, ".venv", "bin", "python"),
      ];

  for (const candidate of venvCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return isWin ? "python" : "python3";
}

/**
 * Resolves the Node.js executable path.
 */
export function resolveNodeExecutable(): string {
  return process.execPath;
}

/**
 * Builds a minimal, secret-free environment map for the child Python process.
 * Never leaks DATABASE_URL, R2_SECRET_ACCESS_KEY, OAuth tokens, or API keys.
 */
export function buildSanitizedPythonEnv(
  workspaceDir: string,
  skillScriptsDir: string
): NodeJS.ProcessEnv {
  const isWin = os.platform() === "win32";
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    PYTHONPATH: skillScriptsDir,
    HOME: workspaceDir,
    USERPROFILE: workspaceDir,
    TMPDIR: workspaceDir,
    TEMP: workspaceDir,
    TMP: workspaceDir,
  };

  if (process.env.PATH) {
    env.PATH = process.env.PATH;
  }
  if (isWin) {
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    if (process.env.WINDIR) env.WINDIR = process.env.WINDIR;
  }

  return env;
}

/**
 * Builds a minimal, secret-free environment map for the child Node.js process.
 * Never leaks DATABASE_URL, R2_SECRET_ACCESS_KEY, OAuth tokens, or API keys.
 */
export function buildSanitizedNodeEnv(workspaceDir: string): NodeJS.ProcessEnv {
  const isWin = os.platform() === "win32";
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    NODE_PATH: EXECUTOR_CONFIG.nodeModulesDir,
    HOME: workspaceDir,
    USERPROFILE: workspaceDir,
    TMPDIR: workspaceDir,
    TEMP: workspaceDir,
    TMP: workspaceDir,
  };

  if (isWin) {
    if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    if (process.env.WINDIR) env.WINDIR = process.env.WINDIR;
  }

  return env;
}

/**
 * Validates and resolves a skill directory inside `.devnuby/skills/<skill>`.
 */
export function resolveSkillDirectory(skill: string): {
  skillName: string;
  skillDir: string;
  skillScriptsDir: string;
} {
  const cleanSkill = String(skill || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  if (!cleanSkill) {
    throw new Error("Invalid skill name.");
  }

  const skillDir = path.resolve(EXECUTOR_CONFIG.skillsRootDir, cleanSkill);
  const rel = path.relative(EXECUTOR_CONFIG.skillsRootDir, skillDir);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path traversal detected while resolving skill directory.");
  }
  if (!fs.existsSync(skillDir)) {
    throw new Error(`Skill '${cleanSkill}' does not exist in '.devnuby/skills/'.`);
  }

  return {
    skillName: cleanSkill,
    skillDir,
    skillScriptsDir: path.join(skillDir, "scripts"),
  };
}

/**
 * Validates and resolves a target script inside `.devnuby/skills/<skill>/scripts/<script>`.
 * Prevents any directory traversal or execution outside the skill's `scripts/` folder.
 */
export function resolveSkillScriptPath(
  skill: string,
  script: string,
  runtime: SkillScriptRuntime = "python"
): {
  skillName: string;
  scriptName: string;
  skillDir: string;
  skillScriptsDir: string;
  scriptFullPath: string;
} {
  const { skillName, skillDir, skillScriptsDir } = resolveSkillDirectory(skill);

  const rawScript = String(script || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/^scripts\//i, "");

  const allowedExts =
    runtime === "node"
      ? EXECUTOR_CONFIG.allowedNodeExtensions
      : EXECUTOR_CONFIG.allowedPythonExtensions;

  if (
    !rawScript ||
    rawScript.includes("..") ||
    rawScript.includes("\0") ||
    path.isAbsolute(rawScript) ||
    !allowedExts.some((ext) => rawScript.toLowerCase().endsWith(ext))
  ) {
    throw new Error(
      `Invalid or disallowed script filename '${script}'. Must be a '${allowedExts.join("/")}' file inside the skill's scripts/ directory.`
    );
  }

  const scriptFullPath = path.resolve(skillScriptsDir, rawScript);
  const rel = path.relative(skillScriptsDir, scriptFullPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path traversal detected while resolving skill script.");
  }

  if (!fs.existsSync(scriptFullPath)) {
    throw new Error(
      `Script '${rawScript}' was not found in '.devnuby/skills/${skillName}/scripts/'.`
    );
  }

  return {
    skillName,
    scriptName: rawScript,
    skillDir,
    skillScriptsDir,
    scriptFullPath,
  };
}
