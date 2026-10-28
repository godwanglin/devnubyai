import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/client";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import { getChatSession } from "@/lib/chat/service";

const updateToolSchema = z.object({
  toolCallId: z.string().trim().min(1, "toolCallId is required"),
  selectedId: z.string().trim().min(1, "selectedId is required"),
});

type RouteContext = {
  params: Promise<{ chatId: string; messageId: string }>;
};

/**
 * PATCH /api/v1/chats/[chatId]/messages/[messageId]/tool-state
 * Persists user interaction with a widget (such as quiz option selection) into ChatMessage.parts.
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

    let partsList: any[] = [];
    if (typeof message.parts === "string") {
      try {
        partsList = JSON.parse(message.parts);
      } catch {}
    } else if (Array.isArray(message.parts)) {
      partsList = message.parts;
    }

    let updated = false;
    const updatedParts = partsList.map((part) => {
      if (
        part &&
        typeof part === "object" &&
        part.toolCallId === parsed.data.toolCallId
      ) {
        updated = true;
        return {
          ...part,
          input: {
            ...(typeof part.input === "object" && part.input ? part.input : {}),
            selectedId: parsed.data.selectedId,
            selectedAt: new Date().toISOString(),
          },
        };
      }
      return part;
    });

    if (updated) {
      await db.chatMessage.update({
        where: { id: message.id },
        data: {
          parts: updatedParts as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return jsonSuccess({
      toolCallId: parsed.data.toolCallId,
      selectedId: parsed.data.selectedId,
      persisted: updated,
    }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
