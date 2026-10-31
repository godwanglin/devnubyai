/**
 * Text the user selected from the conversation and attached to a message
 * ("Tanya Devnuby"). Stored as `{ type: "quote" }` entries in ChatMessage.parts.
 * Isomorphic: safe to import from client and server.
 */
export const MAX_QUOTES_PER_MESSAGE = 5;
export const MAX_QUOTE_CHARS = 2000;

export interface QuotePart {
  type: "quote";
  text: string;
}

export function isQuotePart(part: unknown): part is QuotePart {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as { type?: unknown }).type === "quote" &&
    typeof (part as { text?: unknown }).text === "string"
  );
}

/** Reads quote texts from a persisted parts value (array or JSON string). */
export function extractQuotes(parts: unknown): string[] {
  let list: unknown = parts;
  if (typeof parts === "string") {
    try {
      list = JSON.parse(parts);
    } catch {
      return [];
    }
  }
  return Array.isArray(list) ? list.filter(isQuotePart).map((p) => p.text) : [];
}

/** Prefixes the user's prompt with the quoted excerpts so the model knows what they refer to. */
export function withQuotedContext(content: string, quotes: string[]): string {
  if (quotes.length === 0) return content;
  const quoted = quotes
    .map((q) =>
      q
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")
    )
    .join("\n\n");
  return `[The user selected these excerpts from the conversation and is asking about them]\n${quoted}\n\n${content}`;
}
