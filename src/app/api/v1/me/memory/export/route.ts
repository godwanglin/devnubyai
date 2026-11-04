import JSZip from "jszip";
import { requireUser } from "@/lib/auth/session";
import { getRequestId, jsonError } from "@/lib/api/response";
import { listAllUserMemoryNotes, type UserMemoryNote } from "@/lib/chat/user-memory";

function slug(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "note"
  );
}

function noteMarkdown(note: UserMemoryNote): string {
  return `# ${note.title}\n\n${note.content}\n\n---\nUpdated: ${note.updatedAt}\n`;
}

/**
 * GET /api/v1/me/memory/export: every memory note as Markdown in a .zip
 * (`memory.md` with all notes, plus one file per note under `notes/`).
 */
export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await requireUser();
    const notes = await listAllUserMemoryNotes(user.id);

    const zip = new JSZip();
    zip.file(
      "memory.md",
      notes.length > 0
        ? `# Devnuby Memory\n\n${notes.map((n) => `## ${n.title}\n\n${n.content}\n`).join("\n")}`
        : "# Devnuby Memory\n\n_No saved memory._\n"
    );
    const used = new Set<string>();
    notes.forEach((note, idx) => {
      let name = `${String(idx + 1).padStart(3, "0")}-${slug(note.title)}.md`;
      while (used.has(name)) name = name.replace(/\.md$/, "-1.md");
      used.add(name);
      zip.file(`notes/${name}`, noteMarkdown(note));
    });

    const body = await zip.generateAsync({ type: "uint8array" });
    const date = new Date().toISOString().slice(0, 10);
    return new Response(new Blob([body as BlobPart]), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="devnuby-memory-${date}.zip"`,
        "Cache-Control": "no-store",
        "x-request-id": requestId,
      },
    });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
