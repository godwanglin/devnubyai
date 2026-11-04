import fs from "node:fs/promises";
import path from "node:path";

export interface DevnubySkillMeta {
  name: string;
  title: string;
  description: string;
  version?: string;
  path: string;
  availableDocs?: string[];
  availableScripts?: string[];
}

export interface DevnubySkillDetail extends DevnubySkillMeta {
  file: string;
  content: string;
}

// Runtime path, not a bundle input (see src/executors/config.ts)
const SKILLS_DIR = path.resolve(/* turbopackIgnore: true */ process.cwd(), ".devnuby", "skills");

/**
 * Parses simple YAML-like frontmatter at the top of a SKILL.md file.
 */
function parseFrontmatter(raw: string): { meta: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  if (!match) {
    return { meta: {}, body: raw };
  }
  const lines = match[1].split(/\r?\n/);
  const meta: Record<string, string> = {};
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
      meta[key] = val;
    }
  }
  return { meta, body: match[2] };
}

async function walkPyScripts(
  scriptsRoot: string,
  currentDir = scriptsRoot
): Promise<string[]> {
  const results: string[] = [];
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const s of entries) {
    if (s.name.startsWith(".") || s.name === "__pycache__") continue;
    const full = path.join(currentDir, s.name);
    if (s.isDirectory()) {
      results.push(...(await walkPyScripts(scriptsRoot, full)));
    } else if (s.isFile() && s.name.toLowerCase().endsWith(".py")) {
      results.push(path.relative(scriptsRoot, full).replace(/\\/g, "/"));
    }
  }
  return results;
}

async function inspectSkillAssets(skillDir: string): Promise<{
  docs: string[];
  scripts: string[];
}> {
  const docs: string[] = [];
  let scripts: string[] = [];
  try {
    const entries = await fs.readdir(skillDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
        docs.push(e.name);
      }
    }
  } catch {
    // ignore
  }
  try {
    scripts = await walkPyScripts(path.join(skillDir, "scripts"));
  } catch {
    // ignore
  }
  return {
    docs: docs.sort(),
    scripts: scripts.sort(),
  };
}

/**
 * Scans `.devnuby/skills/` for all available skill subdirectories containing `SKILL.md`.
 */
export async function listDevnubySkills(): Promise<DevnubySkillMeta[]> {
  try {
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    const skills: DevnubySkillMeta[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(SKILLS_DIR, entry.name);
      const skillFile = path.join(skillDir, "SKILL.md");
      try {
        const raw = await fs.readFile(skillFile, "utf-8");
        const { meta } = parseFrontmatter(raw);
        const assets = await inspectSkillAssets(skillDir);
        skills.push({
          name: meta.name || entry.name,
          title: meta.title || entry.name,
          description: meta.description || `Specialized skill for ${entry.name}`,
          version: meta.version,
          path: skillFile,
          availableDocs: assets.docs,
          availableScripts: assets.scripts,
        });
      } catch {
        // Skill file missing or unreadable, skip silently
      }
    }
    return skills.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/**
 * Loads the full content of a specific skill by its slug name (and optional markdown sub-file like `forms.md` or `reference.md`).
 */
export async function loadDevnubySkill(
  name: string,
  file = "SKILL.md"
): Promise<DevnubySkillDetail | null> {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!sanitized) return null;

  const cleanFile = path.basename(String(file || "SKILL.md").trim());
  if (!cleanFile.toLowerCase().endsWith(".md") || cleanFile.includes("..")) {
    return null;
  }

  const skillDir = path.join(SKILLS_DIR, sanitized);
  const mainSkillFile = path.join(skillDir, "SKILL.md");

  try {
    const mainRaw = await fs.readFile(mainSkillFile, "utf-8");
    const { meta } = parseFrontmatter(mainRaw);
    const assets = await inspectSkillAssets(skillDir);

    // Match doc filename case-insensitively (e.g. FORMS.md -> forms.md)
    const matchedDoc =
      assets.docs.find((d) => d.toLowerCase() === cleanFile.toLowerCase()) ||
      "SKILL.md";
    const targetFile = path.join(skillDir, matchedDoc);
    const targetRaw = await fs.readFile(targetFile, "utf-8");
    const { body } = parseFrontmatter(targetRaw);

    const runtimeAdapterFooter = [
      "",
      "---",
      `### Devnuby AI Runtime Execution Guide for \`${meta.name || sanitized}\``,
      assets.scripts.length > 0
        ? `- Available helper scripts in \`.devnuby/skills/${sanitized}/scripts/\`: ${assets.scripts.map((s) => `\`${s}\``).join(", ")}.`
        : `- No pre-built helper scripts in \`.devnuby/skills/${sanitized}/scripts/\`; use inline \`code\` execution via \`run_skill_script\`.`,
      `- Available skill docs in \`.devnuby/skills/${sanitized}/\`: ${assets.docs.map((d) => `\`${d}\``).join(", ")}.`,
      `- **Running helper scripts**: Whenever instructions above say \`python scripts/<script>.py <args>\`, call \`run_skill_script\` with \`{"skill": "${sanitized}", "script": "<script>.py", "args": [...]}\`.`,
      `- **Creating or editing files with custom code**: Do NOT call legacy fallback tools (\`create_document\`, \`create_spreadsheet\`, \`create_presentation\`) now that you have loaded this skill! Instead, execute your Python (\`reportlab\`, \`openpyxl\`, \`pandas\`, \`pypdf\`, \`pdfplumber\`) or Node.js (\`docx\`, \`pptxgenjs\`) code directly via \`run_skill_script\` with \`{"skill": "${sanitized}", "runtime": "python" | "node", "code": "..."}\`, saving output files into the current working directory (e.g. \`"My_Output.pdf"\`, \`"Financial_Model.xlsx"\`, \`"Report.docx"\`, \`"Deck.pptx"\`). Every generated file is automatically uploaded to session storage and displayed as an interactive card for the user.`,
      `- **Custom & System Fonts (PDF & Office)**: Both standard fonts (\`"Times New Roman"\`, \`"Arial"\`, \`"Calibri"\`) and Google Fonts (e.g. \`"Lexend Deca"\`, \`"Poppins"\`, \`"Inter"\`, \`"Plus Jakarta Sans"\`, \`"Montserrat"\`) are automatically downloaded, cached in \`.devnuby/fonts/\`, and pre-registered in \`reportlab\` (\`fontName="Lexend Deca"\`, \`fontName="Lexend Deca-Bold"\`, \`fontName="Times New Roman"\`, \`fontName="Times New Roman-Bold"\`) as well as DOCX/XLSX/PPTX.`,
    ].join("\n");

    return {
      name: meta.name || sanitized,
      title: meta.title || sanitized,
      description: meta.description || "",
      version: meta.version,
      path: targetFile,
      file: matchedDoc,
      availableDocs: assets.docs,
      availableScripts: assets.scripts,
      content: `${body.trim()}${runtimeAdapterFooter}`,
    };
  } catch {
    return null;
  }
}

/**
 * Builds a compact summary block of available skills to inject into the system prompt.
 */
export async function buildSkillsSystemPromptBlock(): Promise<string> {
  const skills = await listDevnubySkills();
  if (skills.length === 0) return "";

  const lines = skills.map((s) => {
    const scriptsNote =
      s.availableScripts && s.availableScripts.length > 0
        ? ` [scripts: ${s.availableScripts.join(", ")}]`
        : "";
    return `- \`${s.name}\`: ${s.title} — ${s.description}${scriptsNote}`;
  });
  return [
    "## Specialized AI Skills (.devnuby/skills)",
    "You have access to specialized domain skills in `.devnuby/skills/`. When performing specialized tasks (e.g. creating or filling PDF/Word documents), apply these guidelines:",
    lines.join("\n"),
    "To read the complete guidelines, best practices, or sub-documents (`forms.md`, `reference.md`) for a skill, call `load_skill` with the skill name (e.g. `{\"name\": \"pdf\"}` or `{\"name\": \"pdf\", \"file\": \"forms.md\"}`). To run a skill's Python helper script, call `run_skill_script`.",
  ].join("\n");
}
