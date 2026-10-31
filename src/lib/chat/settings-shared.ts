import { z } from "zod";

/** Client-safe part of the chat settings (no DB access). */
export const MAX_TOOL_ROUNDS_LIMIT = 50;

export const chatSettingsSchema = z.object({
  maxToolRounds: z.number().int().min(1).max(MAX_TOOL_ROUNDS_LIMIT),
});

export type ChatSettings = z.infer<typeof chatSettingsSchema>;
