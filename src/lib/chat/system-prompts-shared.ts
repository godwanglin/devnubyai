import { z } from "zod";

/** Client-safe part of the system prompt feature (no DB access). */

export interface PromptPlaceholder {
  key: string;
  /** i18n key under admin.systemPrompts.placeholders */
  descriptionKey: string;
  example: string;
}

/** Placeholders an admin can write as `{key}`; filled per request. Unknown ones are left as-is. */
export const PROMPT_PLACEHOLDERS: PromptPlaceholder[] = [
  { key: "model.id", descriptionKey: "modelId", example: "google/gemini-3.8-flash" },
  { key: "model.name", descriptionKey: "modelName", example: "Gemini 3.8 Flash" },
  { key: "model.provider", descriptionKey: "modelProvider", example: "Google" },
  { key: "model.description", descriptionKey: "modelDescription", example: "Fast multimodal model" },
  { key: "model.context_window", descriptionKey: "modelContextWindow", example: "1000000" },
  { key: "model.capabilities", descriptionKey: "modelCapabilities", example: "vision, tools, reasoning" },
  { key: "user.name", descriptionKey: "userName", example: "Aiden" },
  { key: "date", descriptionKey: "date", example: "Thursday, 30 October 2026" },
  { key: "time", descriptionKey: "time", example: "14:05 WIB" },
  { key: "year", descriptionKey: "year", example: "2026" },
];

export const systemPromptInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  content: z.string().trim().min(1).max(20_000),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(65_535).default(100),
});

export const systemPromptUpdateSchema = systemPromptInputSchema.partial();

export type SystemPromptInput = z.infer<typeof systemPromptInputSchema>;

export interface SystemPromptDto {
  id: string;
  name: string;
  content: string;
  isActive: boolean;
  sortOrder: number;
  updatedAt: string;
}

/** Replaces known `{placeholders}`; unknown ones stay visible so typos are noticeable. */
export function renderPromptTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z_]+(?:\.[a-z_]+)*)\}/g, (match, key: string) =>
    key in values ? values[key] : match
  );
}
