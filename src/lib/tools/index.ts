import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";
import { webSearchTool } from "./web-search";
import { deepSearchTool } from "./deep-search";
import { writeFileTool } from "./write-file";
import { editFileTextTool } from "./edit-file-text";
import { readFileTool } from "./read-file";
import { readProjectSourceTool } from "./read-project-source";
import { createSpreadsheetTool } from "./create-spreadsheet";
import { createDocumentTool } from "./create-document";
import { createPresentationTool } from "./create-presentation";
import { interactiveQuizTool } from "./interactive-quiz";
import { executeCodeTool } from "./execute-code";
import { calculateTool } from "./calculate";
import { fetchUrlTool } from "./fetch-url";
import { memoryNoteTool } from "./memory-note";

export * from "./types";
export * from "./ssrf";
export * from "./web-search";
export * from "./deep-search";
export * from "./write-file";
export * from "./edit-file-text";
export * from "./read-file";
export * from "./read-project-source";
export * from "./create-spreadsheet";
export * from "./create-document";
export * from "./create-presentation";
export * from "./vision-tool";
export * from "./interactive-quiz";
export * from "./execute-code";
export * from "./calculate";
export * from "./fetch-url";
export * from "./memory-note";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RegisteredTool = ToolDefinition<any, any>;

/**
 * All active tools available to Devnuby AI.
 * Note: visionTool is temporarily disabled for standard chat workflows
 * because multimodal vision models (GPT-4o, Claude 3.5, Gemini) receive images
 * directly as native multimodal content parts (Base64) rather than through tool calls.
 */
export const devnubyTools: RegisteredTool[] = [
  webSearchTool,
  deepSearchTool,
  writeFileTool,
  editFileTextTool,
  readFileTool,
  readProjectSourceTool,
  createSpreadsheetTool,
  createDocumentTool,
  createPresentationTool,
  // visionTool, // Disabled in favor of native multimodal Base64 injection
  interactiveQuizTool,
  executeCodeTool,
  calculateTool,
  fetchUrlTool,
  memoryNoteTool,
];

/**
 * Map of tools indexed by their unique name.
 */
export const toolRegistry = new Map<string, RegisteredTool>(
  devnubyTools.map((t) => [t.name, t])
);

/**
 * Retrieves a tool definition by name.
 */
export function getToolByName(name: string): RegisteredTool | undefined {
  return toolRegistry.get(name);
}

/**
 * Returns formatted JSON schemas of all tools for LLM tool calling (OpenAI / Anthropic format).
 */
export function getAllToolSchemas() {
  return devnubyTools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

/**
 * Safe executor for any registered tool with context validation and error boundary.
 */
export async function executeTool(
  name: string,
  rawParams: Record<string, unknown>,
  context: ToolExecutionContext
): Promise<ToolExecutionResult> {
  const tool = getToolByName(name);
  if (!tool) {
    return {
      success: false,
      error: {
        code: "INVALID_PARAM",
        message: `Tool '${name}' is not registered in the system.`,
      },
    };
  }

  // Ensure mandatory tenant context
  if (!context.userId || !context.sessionId) {
    return {
      success: false,
      error: {
        code: "INVALID_PARAM",
        message: "Incomplete session context: 'userId' and 'sessionId' are required.",
      },
    };
  }

  try {
    return await tool.execute(rawParams as never, context);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown";
    return {
      success: false,
      error: {
        code: "EXECUTION_ERROR",
        message: `An unexpected error occurred while executing tool '${name}': ${message}`,
      },
    };
  }
}
