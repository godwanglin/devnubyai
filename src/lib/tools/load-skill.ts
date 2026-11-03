import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";
import { loadDevnubySkill, listDevnubySkills } from "../skills/runtime";

export interface LoadSkillParams {
  name: string;
}

export interface LoadSkillData {
  name: string;
  title: string;
  description: string;
  version?: string;
  content: string;
}

export const loadSkillTool: ToolDefinition<LoadSkillParams, LoadSkillData> = {
  name: "load_skill",
  description:
    "Loads detailed domain guidance, style standards, and structural schemas from a specialized skill in `.devnuby/skills/` (e.g. 'docx' for professional Word documents, proposals, CVs, and reports). Call this before generating complex domain-specific deliverables to follow proven best practices.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description:
          "The name of the skill to load (e.g. 'docx'). Check the list of available skills in system instructions.",
        required: true,
      },
    },
    required: ["name"],
  },
  execute: async (
    params: LoadSkillParams,
    _context: ToolExecutionContext
  ): Promise<ToolExecutionResult<LoadSkillData>> => {
    const startTime = Date.now();
    const name = String(params?.name ?? "").trim().toLowerCase();

    if (!name) {
      const available = await listDevnubySkills();
      const listStr = available.map((s) => `'${s.name}'`).join(", ") || "none";
      return {
        success: false,
        error: {
          code: "INVALID_PARAM",
          message: `Parameter 'name' is required. Available skills: ${listStr}.`,
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    const skill = await loadDevnubySkill(name);
    if (!skill) {
      const available = await listDevnubySkills();
      const listStr = available.map((s) => `'${s.name}'`).join(", ") || "none";
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: `Skill '${name}' not found in .devnuby/skills/. Available skills: ${listStr}.`,
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    return {
      success: true,
      data: {
        name: skill.name,
        title: skill.title,
        description: skill.description,
        version: skill.version,
        content: skill.content,
      },
      metadata: {
        durationMs: Date.now() - startTime,
        provider: "devnuby-skills-runtime",
      },
    };
  },
};
