import { requireUser } from "@/lib/auth/session";
import { getChatSession } from "@/lib/chat/service";
import { db } from "@/lib/db";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { executeWithFallback } from "@/lib/routing/executor";

type RouteContext = { params: Promise<{ chatId: string }> };

/**
 * Generates an intelligent 2-5 word title for a chat session using AI.
 * Called automatically in the background after the first user-assistant turn.
 */
export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    const { chatId } = await context.params;

    const session = await getChatSession(user.id, chatId);

    // Title is generated once, on the first turn only: later turns keep the existing title
    const userTurns = await db.chatMessage.count({
      where: { sessionId: session.id, role: "user" },
    });
    if (userTurns !== 1) {
      return jsonSuccess({ title: session.title }, { requestId });
    }

    const messages = await db.chatMessage.findMany({
      where: {
        sessionId: session.id,
        status: "completed",
      },
      orderBy: { id: "asc" },
      take: 4,
      select: {
        role: true,
        content: true,
      },
    });

    if (messages.length === 0) {
      return jsonSuccess({ title: session.title }, { requestId });
    }

    // Build concise context for naming model
    const conversationSnippet = messages
      .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content.slice(0, 300)}`)
      .join("\n\n");

    const promptMessages = [
      {
        role: "system" as const,
        content:
          "You are an expert conversation titling assistant. Based on the conversation excerpt, generate a concise, descriptive title in 2 to 5 words in the same language as the user. Output ONLY the raw title text. Do not wrap in quotes. Do not add markdown or trailing punctuation.",
      },
      {
        role: "user" as const,
        content: conversationSnippet,
      },
    ];

    // Pick active model for title generation (session model or active catalog model)
    const catalogModel = session.catalogModelPublicId
      ? await db.catalogModel.findFirst({
          where: { publicId: session.catalogModelPublicId, status: "active" },
        })
      : null;

    const activeModel =
      catalogModel ??
      (await db.catalogModel.findFirst({
        where: { status: "active" },
        orderBy: { sortOrder: "asc" },
      }));

    if (!activeModel) {
      return jsonSuccess({ title: session.title }, { requestId });
    }

    const stream = executeWithFallback({
      publicModelId: activeModel.publicId,
      requestId,
      userId: user.id,
      request: {
        messages: promptMessages,
        maxTokens: 30,
        temperature: 0.3,
      },
    });

    let generatedTitle = "";
    for await (const event of stream) {
      if (event.type === "delta") {
        generatedTitle += event.text;
      }
    }

    const cleanTitle = generatedTitle
      .replace(/["'“”]/g, "")
      .replace(/^[#*\s-]+|[#*\s.-]+$/g, "")
      .trim()
      .slice(0, 80);

    if (cleanTitle && cleanTitle.length >= 2) {
      await db.chatSession.update({
        where: { id: session.id },
        data: { title: cleanTitle },
      });
      return jsonSuccess({ title: cleanTitle }, { requestId });
    }

    return jsonSuccess({ title: session.title }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
