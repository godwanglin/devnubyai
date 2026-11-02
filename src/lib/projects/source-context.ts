import { db } from "@/lib/db";
import { downloadFromR2 } from "@/lib/storage/r2";
import { extractDocumentText } from "@/lib/files/extractors";
import { getCachedJson, setCachedJson } from "@/lib/redis/client";
import { formatFileSize } from "@/lib/files/policy";

/**
 * Project sources ("knowledge base"): files uploaded on the project page that
 * every chat inside the project can draw on. Small sources are inlined into the
 * system prompt; the rest stay reachable through the `read_project_source` tool.
 */

/** Share of the model context window the inlined sources may take. */
const INLINE_CONTEXT_SHARE = 0.25;
/** Rough chars-per-token ratio used to turn the context window into a char budget. */
const CHARS_PER_TOKEN = 4;
const MAX_INLINE_CHARS = 200_000;
/** Budget when the catalog model has no context window configured. */
const FALLBACK_INLINE_CHARS = 48_000;
/** A mentioned source is always inlined, up to this many chars. */
const MAX_MENTION_CHARS = 80_000;
/** Extracted text kept per source (cache + tool reads). */
const MAX_STORED_CHARS = 1_000_000;
/** Sources larger than this are listed but never auto-extracted. */
const MAX_AUTO_EXTRACT_BYTES = 20 * 1024 * 1024;
const MAX_LISTED_SOURCES = 50;
const TEXT_CACHE_TTL_SECONDS = 24 * 60 * 60;

export interface ProjectSourceFile {
  publicId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ProjectSourceText {
  text: string | null;
  error?: string;
}

interface ProjectRef {
  projectPublicId: string;
  ownerPublicId: string;
}

// Process-local copy for when Redis is unavailable. Source files are immutable,
// so entries never go stale; the cap only bounds memory.
const localTextCache = new Map<string, ProjectSourceText>();

function textCacheKey(filePublicId: string): string {
  return `project-source:text:${filePublicId}`;
}

/**
 * Extracted text of one project source (PDF, Office, plain text, ...), cached
 * by file id. Returns `{ text: null, error }` for images and unreadable files.
 */
export async function getProjectSourceText(
  file: ProjectSourceFile,
  project: ProjectRef
): Promise<ProjectSourceText> {
  if (file.mimeType.startsWith("image/")) {
    return { text: null, error: "Image source: no extractable text" };
  }

  const key = textCacheKey(file.publicId);
  const local = localTextCache.get(key);
  if (local) return local;
  const cached = await getCachedJson<ProjectSourceText>(key);
  if (cached) {
    localTextCache.set(key, cached);
    return cached;
  }

  let result: ProjectSourceText;
  try {
    const downloaded = await downloadFromR2({
      userId: project.ownerPublicId,
      sessionId: project.projectPublicId,
      filename: file.filename,
    });
    const extraction = await extractDocumentText(downloaded.content, file.filename, file.mimeType);
    result = extraction.success
      ? { text: extraction.text.slice(0, MAX_STORED_CHARS) }
      : { text: null, error: extraction.error || "Unsupported format" };
  } catch (err) {
    // Storage hiccups are not cached, so the next request retries
    return { text: null, error: err instanceof Error ? err.message : "Failed to load source" };
  }

  if (localTextCache.size > 200) localTextCache.clear();
  localTextCache.set(key, result);
  await setCachedJson(key, result, TEXT_CACHE_TTL_SECONDS);
  return result;
}

/** Loads a session's project with its owner and sources, or null when the chat is not in a project. */
export async function loadSessionProject(sessionId: bigint) {
  const session = await db.chatSession.findUnique({
    where: { id: sessionId },
    select: {
      project: {
        select: {
          id: true,
          publicId: true,
          name: true,
          customInstructions: true,
          user: { select: { publicId: true } },
          projectFiles: {
            orderBy: { createdAt: "asc" },
            take: MAX_LISTED_SOURCES,
            select: { publicId: true, filename: true, mimeType: true, sizeBytes: true },
          },
        },
      },
    },
  });
  const project = session?.project;
  if (!project) return null;

  return {
    id: project.id,
    publicId: project.publicId,
    name: project.name,
    customInstructions: project.customInstructions,
    ref: { projectPublicId: project.publicId, ownerPublicId: project.user.publicId } as ProjectRef,
    files: project.projectFiles.map<ProjectSourceFile>((f) => ({
      publicId: f.publicId,
      filename: f.filename,
      mimeType: f.mimeType,
      sizeBytes: Number(f.sizeBytes),
    })),
  };
}

export type SessionProject = NonNullable<Awaited<ReturnType<typeof loadSessionProject>>>;

/** Finds a project source by id, exact name, or name without extension (case-insensitive). */
export function findProjectSource(
  files: ProjectSourceFile[],
  query: string
): ProjectSourceFile | undefined {
  const q = query.trim().replace(/^@/, "").toLowerCase();
  if (!q) return undefined;
  const stem = (name: string) => name.replace(/\.[^/.]+$/, "");
  return (
    files.find((f) => f.publicId.toLowerCase() === q) ??
    files.find((f) => f.filename.toLowerCase() === q) ??
    files.find((f) => stem(f.filename.toLowerCase()) === stem(q))
  );
}

function inlineBudgetChars(contextWindow: number | null): number {
  if (!contextWindow || contextWindow <= 0) return FALLBACK_INLINE_CHARS;
  return Math.min(
    MAX_INLINE_CHARS,
    Math.floor(contextWindow * CHARS_PER_TOKEN * INLINE_CONTEXT_SHARE)
  );
}

function fenceSource(file: ProjectSourceFile, text: string, truncated: boolean): string {
  return [
    `<source name="${file.filename}" id="${file.publicId}"${truncated ? ' truncated="true"' : ""}>`,
    text,
    "</source>",
  ].join("\n");
}

/**
 * System prompt for a chat inside a project: custom instructions, the source
 * index, and as much source text as fits the model's budget. Mentioned sources
 * are inlined first so they always reach the model.
 */
export async function buildProjectContextPrompt(options: {
  project: SessionProject;
  mentionedSourceIds?: string[];
  contextWindow: number | null;
  supportsTools: boolean;
}): Promise<string | null> {
  const { project, contextWindow, supportsTools } = options;
  const mentionedIds = new Set(options.mentionedSourceIds ?? []);
  const instructions = project.customInstructions?.trim();
  if (!instructions && project.files.length === 0) return null;

  const sections: string[] = [`# Project "${project.name}"`];

  if (instructions) {
    sections.push(`## Custom Instructions\n${instructions}`);
  }

  if (project.files.length > 0) {
    // Mentioned first, then the rest in upload order
    const ordered = [
      ...project.files.filter((f) => mentionedIds.has(f.publicId)),
      ...project.files.filter((f) => !mentionedIds.has(f.publicId)),
    ];

    const texts = await Promise.all(
      ordered.map((f) =>
        mentionedIds.has(f.publicId) || f.sizeBytes <= MAX_AUTO_EXTRACT_BYTES
          ? getProjectSourceText(f, project.ref)
          : Promise.resolve<ProjectSourceText>({ text: null, error: "Too large to load automatically" })
      )
    );

    let remaining = inlineBudgetChars(contextWindow);
    const inlined: string[] = [];
    const indexLines: string[] = [];

    ordered.forEach((file, i) => {
      const { text, error } = texts[i];
      const isMentioned = mentionedIds.has(file.publicId);
      const meta = `${file.filename} | ID: ${file.publicId} | ${formatFileSize(file.sizeBytes)} | ${file.mimeType}`;

      if (text === null) {
        indexLines.push(`- ${meta} | not loaded (${error ?? "unreadable"})`);
        return;
      }
      if (!text.trim()) {
        indexLines.push(`- ${meta} | empty (no extractable text)`);
        return;
      }

      const limit = isMentioned ? Math.max(remaining, MAX_MENTION_CHARS) : remaining;
      if (text.length <= limit) {
        inlined.push(fenceSource(file, text, false));
        remaining = Math.max(0, remaining - text.length);
        indexLines.push(`- ${meta} | full text below${isMentioned ? " | MENTIONED by the user" : ""}`);
      } else if (isMentioned) {
        inlined.push(fenceSource(file, text.slice(0, limit), true));
        remaining = Math.max(0, remaining - limit);
        indexLines.push(`- ${meta} | partial text below (first ${limit} chars) | MENTIONED by the user`);
      } else {
        indexLines.push(`- ${meta} | not inlined (too long)`);
      }
    });

    const guidance = [
      "These files are the project's shared knowledge base. Treat them as the primary reference for questions in this project and cite the file name when you use them.",
      "Sources marked MENTIONED were explicitly picked by the user for the current message: focus on them.",
      supportsTools
        ? "For sources that are partial or not inlined, call `read_project_source` with the file name or ID to read them (100 lines per call). Do not use `read_file` for project sources."
        : "Sources that are not inlined cannot be read with the current model; tell the user if one is needed.",
    ];

    sections.push(`## Project Sources\n${guidance.join("\n")}\n\n${indexLines.join("\n")}`);
    if (inlined.length > 0) {
      sections.push(`## Source Contents\n${inlined.join("\n\n")}`);
    }
  }

  return sections.join("\n\n");
}
