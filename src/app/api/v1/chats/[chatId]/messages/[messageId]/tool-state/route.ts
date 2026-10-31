import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/client";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import { getChatSession } from "@/lib/chat/service";

const persistedChartSchema = z.object({
  id: z.string().trim().max(64).optional(),
  url: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(200),
});

const executionResultSchema = z.object({
  status: z.enum(["completed", "error"]),
  stdout: z.string().max(20_000).optional(),
  stderr: z.string().max(20_000).optional(),
  resultText: z.string().max(8_000).optional(),
  durationMs: z.number().int().nonnegative().max(120_000).optional(),
  charts: z.array(persistedChartSchema).max(4).optional(),
});

const updateToolSchema = z
  .object({
    toolCallId: z.string().trim().min(1, "toolCallId is required"),
    selectedId: z.string().trim().min(1).optional(),
    executionResult: executionResultSchema.optional(),
  })
  .refine(
    (val) => val.selectedId !== undefined || val.executionResult !== undefined,
    { message: "Either selectedId or executionResult must be provided" }
  );

type RouteContext = {
  params: Promise<{ chatId: string; messageId: string }>;
};

/**
 * PATCH /api/v1/chats/[chatId]/messages/[messageId]/tool-state
 * Persists user interaction or client-side WASM sandbox outputs into ChatMessage.parts.
 */
export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const { chatId, messageId } = await context.params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw ApiError.badRequest("Invalid JSON body");
    }

    const parsed = updateToolSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid update payload", parsed.error.format());
    }

    const session = await getChatSession(user.id, chatId);

    const message = await db.chatMessage.findFirst({
      where: {
        publicId: messageId,
        sessionId: session.id,
      },
      select: { id: true, parts: true },
    });

    if (!message) {
      throw ApiError.notFound("Message not found in this chat session");
    }

    let partsList: unknown[] = [];
    if (typeof message.parts === "string") {
      try {
        const rawParsed = JSON.parse(message.parts);
        if (Array.isArray(rawParsed)) partsList = rawParsed;
      } catch {
        partsList = [];
      }
    } else if (Array.isArray(message.parts)) {
      partsList = message.parts;
    }

    let updated = false;
    const updatedParts = partsList.map((rawPart) => {
      if (!rawPart || typeof rawPart !== "object") return rawPart;
      const part = rawPart as Record<string, unknown>;
      if (part.toolCallId !== parsed.data.toolCallId) return rawPart;

      updated = true;
      const nextPart: Record<string, unknown> = { ...part };

      if (parsed.data.selectedId !== undefined) {
        const existingInput =
          typeof part.input === "object" && part.input !== null
            ? (part.input as Record<string, unknown>)
            : {};
        nextPart.input = {
          ...existingInput,
          selectedId: parsed.data.selectedId,
          selectedAt: new Date().toISOString(),
        };
      }

      if (parsed.data.executionResult !== undefined) {
        const existingOutput =
          typeof part.output === "object" && part.output !== null
            ? (part.output as Record<string, unknown>)
            : {};
        nextPart.output = {
          ...existingOutput,
          executionResult: parsed.data.executionResult,
        };
      }

      return nextPart;
    });

    if (updated) {
      await db.chatMessage.update({
        where: { id: message.id },
        data: {
          parts: updatedParts as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return jsonSuccess(
      {
        toolCallId: parsed.data.toolCallId,
        selectedId: parsed.data.selectedId,
        persisted: updated,
      },
      { requestId }
    );
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
