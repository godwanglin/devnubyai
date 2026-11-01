import { z } from "zod";

/** Client-safe part of the chat settings (no DB access). */
export const MAX_TOOL_ROUNDS_LIMIT = 50;

export const chatSettingsSchema = z.object({
  maxToolRounds: z.number().int().min(1).max(MAX_TOOL_ROUNDS_LIMIT),
  /** When on, every tool call (success or failure) is written to tool_execution_logs. */
  toolDebug: z.boolean(),
  /**
   * Catalog model (publicId) that writes the personalized home headlines/quick prompts.
   * Empty = first active catalog model. Optional key, so older databases keep working.
   */
  homeSuggestionsModel: z.string().trim().max(128).default(""),
});

export type ChatSettings = z.infer<typeof chatSettingsSchema>;
