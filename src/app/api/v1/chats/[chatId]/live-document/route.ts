import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/session";
import { getUnlockedChatSession } from "@/lib/chat/service";
import { readLiveWorkspaceDocument } from "@/executors/workspace-reader";
import { FILE_RESPONSE_CSP, getMimeTypeForFilename } from "@/lib/files/policy";

type RouteContext = { params: Promise<{ chatId: string }> };

/**
 * GET /api/v1/chats/:chatId/live-document?path=laporan.pdf
 *
 * The live document preview: serves a deliverable straight from the chat's sandbox
 * workspace while the script that writes it is still running, before it reaches
 * session storage. The chat stream announces each settled version (`data-live-document`).
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { chatId } = await context.params;
    const session = await getUnlockedChatSession(user.id, chatId);

    const relPath = new URL(request.url).searchParams.get("path") ?? "";
    const file = await readLiveWorkspaceDocument(user.publicId, session.publicId, relPath);
    if (!file) return new NextResponse("Live document not found", { status: 404 });

    const safeName = file.relPath.replace(/["\r\n]/g, "_");
    return new NextResponse(new Uint8Array(file.content), {
      status: 200,
      headers: {
        "Content-Type": getMimeTypeForFilename(file.relPath),
        "Content-Length": String(file.content.length),
        "Cache-Control": "no-store, max-age=0",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": FILE_RESPONSE_CSP,
      },
    });
  } catch {
    return new NextResponse("Live document not available", { status: 404 });
  }
}
