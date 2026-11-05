/**
 * How much of a reply's work the chat shows (Settings > Appearance), stored per user in
 * `user_preferences.response_mode`:
 * - `verbose`: everything (expandable thinking, tool details)
 * - `normal`: one-line thinking + a plain tool list
 * - `silent`: a single status line while working, then only the answer
 * Shared by the server and the client.
 */
export const RESPONSE_MODES = ["verbose", "normal", "silent"] as const;
export type ResponseMode = (typeof RESPONSE_MODES)[number];
export const DEFAULT_RESPONSE_MODE: ResponseMode = "normal";

export function isResponseMode(value: unknown): value is ResponseMode {
  return typeof value === "string" && (RESPONSE_MODES as readonly string[]).includes(value);
}
