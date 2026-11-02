/**
 * Project sources the user @mentioned in a message. Stored as
 * `{ type: "source_mention" }` entries in ChatMessage.parts.
 * Isomorphic: safe to import from client and server.
 */
export const MAX_SOURCE_MENTIONS_PER_MESSAGE = 5;

export interface SourceMention {
  id: string; // ProjectFile publicId
  filename: string;
}

export interface SourceMentionPart extends SourceMention {
  type: "source_mention";
}

export function isSourceMentionPart(part: unknown): part is SourceMentionPart {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as { type?: unknown }).type === "source_mention" &&
    typeof (part as { id?: unknown }).id === "string" &&
    typeof (part as { filename?: unknown }).filename === "string"
  );
}

/** Reads mentions from a persisted parts value (array or JSON string). */
export function extractSourceMentions(parts: unknown): SourceMention[] {
  let list: unknown = parts;
  if (typeof parts === "string") {
    try {
      list = JSON.parse(parts);
    } catch {
      return [];
    }
  }
  return Array.isArray(list)
    ? list.filter(isSourceMentionPart).map(({ id, filename }) => ({ id, filename }))
    : [];
}

/** Notes on the user's turn which sources they pointed at, so history keeps the reference. */
export function withSourceMentionNote(content: string, mentions: SourceMention[]): string {
  if (mentions.length === 0) return content;
  const names = mentions.map((m) => `@${m.filename}`).join(", ");
  return `[The user mentioned these project sources: ${names}]\n${content}`;
}
