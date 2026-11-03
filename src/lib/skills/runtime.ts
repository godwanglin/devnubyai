import fs from "node:fs/promises";
import path from "node:path";

export interface DevnubySkillMeta {
  name: string;
  title: string;
  description: string;
  version?: string;
  path: string;
}

export interface DevnubySkillDetail extends DevnubySkillMeta {
  content: string;
}

const SKILLS_DIR = path.resolve(process.cwd(), ".devnuby", "skills");

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

/**
 * Scans `.devnuby/skills/` for all available skill subdirectories containing `SKILL.md`.
 */
export async function listDevnubySkills(): Promise<DevnubySkillMeta[]> {
  try {
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    const skills: DevnubySkillMeta[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(SKILLS_DIR, entry.name, "SKILL.md");
      try {
        const raw = await fs.readFile(skillFile, "utf-8");
        const { meta } = parseFrontmatter(raw);
        skills.push({
          name: meta.name || entry.name,
          title: meta.title || entry.name,
          description: meta.description || `Specialized skill for ${entry.name}`,
          version: meta.version,
          path: skillFile,
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
 * Loads the full content of a specific skill by its slug name.
 */
export async function loadDevnubySkill(name: string): Promise<DevnubySkillDetail | null> {
  const sanitized = name.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!sanitized) return null;
  const skillFile = path.join(SKILLS_DIR, sanitized, "SKILL.md");
  try {
    const raw = await fs.readFile(skillFile, "utf-8");
    const { meta, body } = parseFrontmatter(raw);
    return {
      name: meta.name || sanitized,
      title: meta.title || sanitized,
      description: meta.description || "",
      version: meta.version,
      path: skillFile,
      content: body.trim(),
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

  const lines = skills.map((s) => `- \`${s.name}\`: ${s.title} — ${s.description}`);
  return [
    "## Specialized AI Skills (.devnuby/skills)",
    "You have access to specialized domain skills in `.devnuby/skills/`. When performing specialized tasks (e.g. creating formal documents), apply these guidelines:",
    lines.join("\n"),
    "To read the complete guidelines, best practices, and templates for a skill, call `load_skill` with the skill name (e.g. `{\"name\": \"docx\"}`).",
  ].join("\n");
}
