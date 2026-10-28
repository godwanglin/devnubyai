import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";
import { webSearchTool } from "./web-search";
import { deepSearchTool } from "./deep-search";
import { writeFileTool } from "./write-file";
import { readFileTool } from "./read-file";
import { visionTool } from "./vision-tool";

export * from "./types";
export * from "./ssrf";
export * from "./web-search";
export * from "./deep-search";
export * from "./write-file";
export * from "./read-file";
export * from "./vision-tool";

/**
 * All active tools available to Devnuby AI.
 */
export const devnubyTools: ToolDefinition<any, any>[] = [
  webSearchTool,
  deepSearchTool,
  writeFileTool,
  readFileTool,
  visionTool,
];

/**
 * Map of tools indexed by their unique name.
 */
export const toolRegistry = new Map<string, ToolDefinition<any, any>>(
  devnubyTools.map((t) => [t.name, t])
);

/**
 * Retrieves a tool definition by name.
 */
export function getToolByName(name: string): ToolDefinition<any, any> | undefined {
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
  rawParams: Record<string, any>,
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
    return await tool.execute(rawParams, context);
  } catch (err: any) {
    return {
      success: false,
      error: {
        code: "EXECUTION_ERROR",
        message: `An unexpected error occurred while executing tool '${name}': ${err?.message || "unknown"}`,
      },
    };
  }
}
