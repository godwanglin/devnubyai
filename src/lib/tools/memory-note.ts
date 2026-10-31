import { db } from "../db";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";

export interface MemoryNoteParams {
  action: "save" | "list" | "delete";
  title?: string;
  content?: string;
  noteId?: string;
  limit?: number;
}

export interface MemoryNoteData {
  action: string;
  note?: {
    id: string;
    title: string;
    content: string;
    createdAt: string;
    updatedAt: string;
  };
  notes?: Array<{
    id: string;
    title: string;
    content: string;
    createdAt: string;
    updatedAt: string;
  }>;
  deleted?: boolean;
  total?: number;
}

export const memoryNoteTool: ToolDefinition<MemoryNoteParams, MemoryNoteData> = {
  name: "memory_note",
  description:
    "Persists short notes/facts to the user's personal memory so they survive across chat sessions. Actions: 'save' (create or update a note by title), 'list' (retrieve saved notes), 'delete' (remove a note by id). Use to remember user preferences, important facts, or decisions the user wants retained.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["save", "list", "delete"],
        description: "Operation to perform.",
        required: true,
      },
      title: {
        type: "string",
        description: "Note title (required for 'save').",
      },
      content: {
        type: "string",
        description: "Note body (required for 'save').",
      },
      noteId: {
        type: "string",
        description: "Note publicId (required for 'delete').",
      },
      limit: {
        type: "number",
        description: "Max notes to return for 'list' (default 20, max 50).",
        default: 20,
      },
    },
    required: ["action"],
  },
  execute: async (
    params: MemoryNoteParams,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult<MemoryNoteData>> => {
    const startTime = Date.now();
    const action = (params?.action || "").trim().toLowerCase();

    if (!["save", "list", "delete"].includes(action)) {
      return {
        success: false,
        error: { code: "INVALID_PARAM", message: "Invalid action. Use 'save', 'list', or 'delete'." },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    try {
      const user = await db.user.findUnique({
        where: { publicId: context.userId },
        select: { id: true },
      });
      if (!user) {
        return {
          success: false,
          error: { code: "NOT_FOUND", message: "User not found." },
          metadata: { durationMs: Date.now() - startTime },
        };
      }

      // Resolve session (optional)
      let sessionId: bigint | null = null;
      if (context.sessionId) {
        const session = await db.chatSession.findUnique({
          where: { publicId: context.sessionId },
          select: { id: true },
        });
        sessionId = session?.id ?? null;
      }

      if (action === "save") {
        const title = String(params?.title || "").trim();
        const content = String(params?.content || "").trim();
        if (!title || !content) {
          return {
            success: false,
            error: { code: "INVALID_PARAM", message: "Both 'title' and 'content' are required for 'save'." },
            metadata: { durationMs: Date.now() - startTime },
          };
        }
        if (title.length > 200) {
          return {
            success: false,
            error: { code: "INVALID_PARAM", message: "Title exceeds 200 characters." },
            metadata: { durationMs: Date.now() - startTime },
          };
        }
        if (content.length > 50_000) {
          return {
            success: false,
            error: { code: "INVALID_PARAM", message: "Content exceeds 50000 characters." },
            metadata: { durationMs: Date.now() - startTime },
          };
        }

        // Upsert by (userId, title)
        const existing = await db.userNote.findFirst({
          where: { userId: user.id, title },
          select: { id: true },
        });

        const row = existing
          ? await db.userNote.update({
              where: { id: existing.id },
              data: { content, sessionId: sessionId ?? undefined },
              select: { publicId: true, title: true, content: true, createdAt: true, updatedAt: true },
            })
          : await db.userNote.create({
              data: { userId: user.id, sessionId, title, content },
              select: { publicId: true, title: true, content: true, createdAt: true, updatedAt: true },
            });

        return {
          success: true,
          data: {
            action: "save",
            note: {
              id: row.publicId,
              title: row.title,
              content: row.content,
              createdAt: row.createdAt.toISOString(),
              updatedAt: row.updatedAt.toISOString(),
            },
          },
          metadata: { durationMs: Date.now() - startTime, provider: "user-notes" },
        };
      }

      if (action === "list") {
        const limit = Math.min(Math.max(Number(params?.limit) || 20, 1), 50);
        const rows = await db.userNote.findMany({
          where: { userId: user.id },
          orderBy: { updatedAt: "desc" },
          take: limit,
          select: { publicId: true, title: true, content: true, createdAt: true, updatedAt: true },
        });
        const notes = rows.map((r) => ({
          id: r.publicId,
          title: r.title,
          content: r.content,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        }));
        return {
          success: true,
          data: { action: "list", notes, total: notes.length },
          metadata: { durationMs: Date.now() - startTime, provider: "user-notes" },
        };
      }

      // delete
      const noteId = String(params?.noteId || "").trim();
      if (!noteId) {
        return {
          success: false,
          error: { code: "INVALID_PARAM", message: "Parameter 'noteId' is required for 'delete'." },
          metadata: { durationMs: Date.now() - startTime },
        };
      }
      const existing = await db.userNote.findFirst({
        where: { publicId: noteId, userId: user.id },
        select: { id: true },
      });
      if (!existing) {
        return {
          success: false,
          error: { code: "NOT_FOUND", message: "Note not found or not owned by user." },
          metadata: { durationMs: Date.now() - startTime },
        };
      }
      await db.userNote.delete({ where: { id: existing.id } });
      return {
        success: true,
        data: { action: "delete", deleted: true },
        metadata: { durationMs: Date.now() - startTime, provider: "user-notes" },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      return {
        success: false,
        error: { code: "EXECUTION_ERROR", message: `Memory note operation failed: ${message}` },
        metadata: { durationMs: Date.now() - startTime },
      };
    }
  },
};
