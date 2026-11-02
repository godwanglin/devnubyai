import { db } from "../db";
import {
  findProjectSource,
  getProjectSourceText,
  loadSessionProject,
} from "../projects/source-context";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";

const MAX_LINES_PER_READ = 100;
const MAX_LINE_CHARACTERS = 2000;

export interface ReadProjectSourceParams {
  filename: string;
  startLine?: number;
  maxLines?: number;
}

export interface ReadProjectSourceData {
  filename: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  hasMore: boolean;
  nextStartLine: number | null;
  content: string;
}

export const readProjectSourceTool: ToolDefinition<ReadProjectSourceParams, ReadProjectSourceData> = {
  name: "read_project_source",
  description:
    "Reads a file from the current project's shared sources (the project knowledge base listed under 'Project Sources'), in line-delimited chunks of up to 100 lines. Use it for project sources that were not fully included in the prompt. For files uploaded in this chat, use `read_file` instead.",
  parameters: {
    type: "object",
    properties: {
      filename: {
        type: "string",
        description: "The project source file name or ID, as listed under 'Project Sources'.",
        required: true,
      },
      startLine: {
        type: "number",
        description: "The 1-indexed starting line number to read (default: 1).",
        default: 1,
      },
      maxLines: {
        type: "number",
        description: "The number of lines to read (min: 1, max: 100, default: 100).",
        default: 100,
      },
    },
    required: ["filename"],
  },
  execute: async (
    params: ReadProjectSourceParams,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult<ReadProjectSourceData>> => {
    const startTime = Date.now();
    const done = () => ({ durationMs: Date.now() - startTime, provider: "cloudflare-r2" });

    const session = await db.chatSession.findFirst({
      where: { publicId: context.sessionId, user: { publicId: context.userId } },
      select: { id: true },
    });
    const project = session ? await loadSessionProject(session.id) : null;
    if (!project) {
      return {
        success: false,
        error: { code: "NOT_FOUND", message: "This chat does not belong to a project with sources." },
        metadata: done(),
      };
    }

    const file = findProjectSource(project.files, params.filename || "");
    if (!file) {
      const available = project.files.map((f) => f.filename).join(", ");
      return {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: `Project source '${params.filename}' not found. Available sources: ${available || "(none)"}`,
        },
        metadata: done(),
      };
    }

    const { text, error } = await getProjectSourceText(file, project.ref);
    if (text === null) {
      return {
        success: false,
        error: { code: "EXECUTION_ERROR", message: `Cannot read '${file.filename}': ${error ?? "unreadable"}` },
        metadata: done(),
      };
    }

    const allLines = text ? text.split(/\r?\n/) : [];
    const totalLines = allLines.length;
    const startLine = Math.max(Math.floor(params.startLine ?? 1), 1);
    const maxLines = Math.min(Math.max(Math.floor(params.maxLines ?? MAX_LINES_PER_READ), 1), MAX_LINES_PER_READ);

    if (startLine > totalLines) {
      return {
        success: true,
        data: {
          filename: file.filename,
          startLine,
          endLine: totalLines,
          totalLines,
          hasMore: false,
          nextStartLine: null,
          content:
            totalLines === 0
              ? `[Source '${file.filename}' has no extractable text]`
              : `[Source has ${totalLines} line(s). Requested startLine ${startLine} is out of bounds.]`,
        },
        metadata: done(),
      };
    }

    const endLine = Math.min(startLine - 1 + maxLines, totalLines);
    const content = allLines
      .slice(startLine - 1, endLine)
      .map((line, idx) => {
        const safeLine =
          line.length > MAX_LINE_CHARACTERS
            ? `${line.slice(0, MAX_LINE_CHARACTERS)}... [truncated: line exceeds max display length]`
            : line;
        return `${startLine + idx}\t${safeLine}`;
      })
      .join("\n");

    const hasMore = endLine < totalLines;
    return {
      success: true,
      data: {
        filename: file.filename,
        startLine,
        endLine,
        totalLines,
        hasMore,
        nextStartLine: hasMore ? endLine + 1 : null,
        content,
      },
      metadata: done(),
    };
  },
};
