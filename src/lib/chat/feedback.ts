/**
 * User feedback ("like" / "dislike" + optional details) stored inside
 * `ChatMessage.parts` as `{ type: "feedback", ... }`.
 * Isomorphic: safe to import from both client and server modules.
 */

export type FeedbackRating = "like" | "dislike";

export interface FeedbackPart {
  type: "feedback";
  rating: FeedbackRating;
  reason?: string;
  comment?: string;
  updatedAt: string;
}

export function isFeedbackPart(part: unknown): part is FeedbackPart {
  if (typeof part !== "object" || part === null) return false;
  const candidate = part as { type?: unknown; rating?: unknown };
  return (
    candidate.type === "feedback" &&
    (candidate.rating === "like" || candidate.rating === "dislike")
  );
}

export function parsePartsArray(parts: unknown): unknown[] {
  if (Array.isArray(parts)) return parts;
  if (typeof parts === "string" && parts.trim().length > 0) {
    try {
      const parsed = JSON.parse(parts);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function stripFeedbackParts(parts: unknown): unknown[] {
  return parsePartsArray(parts).filter((p) => !isFeedbackPart(p));
}
