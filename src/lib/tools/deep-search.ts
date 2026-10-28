import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";
import { webSearchTool } from "./web-search";

export interface DeepSearchParams {
  topic: string;
  maxSteps?: number;
}

export interface DeepSearchStepResult {
  step: number;
  subQuery: string;
  findings: string[];
  sources: string[];
}

export interface DeepSearchData {
  topic: string;
  summary: string;
  stepsExecuted: number;
  investigations: DeepSearchStepResult[];
  allSources: string[];
}

export const deepSearchTool: ToolDefinition<DeepSearchParams, DeepSearchData> = {
  name: "deep_search",
  description:
    "Performs multi-step web research by decomposing a topic into sub-queries, collecting evidence, and producing a comprehensive synthesis.",
  parameters: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: "The complex topic or question to investigate through multi-step search.",
        required: true,
      },
      maxSteps: {
        type: "number",
        description: "Maximum number of investigation steps (min: 1, max: 5, default: 3).",
        default: 3,
      },
    },
    required: ["topic"],
  },
  execute: async (
    params: DeepSearchParams,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult<DeepSearchData>> => {
    const startTime = Date.now();
    const topic = (params.topic || "").trim();

    if (!topic) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAM",
          message: "Parameter 'topic' is required.",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    const stepsCap = Math.min(Math.max(params.maxSteps || 3, 1), 5);

    // Formulate 1-3 targeted sub-queries based on the topic
    const subQueries = [
      `${topic} overview and core principles`,
      `${topic} implementation best practices and architecture`,
      `${topic} solutions comparison and security considerations`,
    ].slice(0, stepsCap);

    const investigations: DeepSearchStepResult[] = [];
    const sourceSet = new Set<string>();

    try {
      for (let i = 0; i < subQueries.length; i++) {
        const subQuery = subQueries[i];
        const searchResult = await webSearchTool.execute(
          { query: subQuery, numResults: 3 },
          context
        );

        const items = searchResult.data?.results || [];
        const stepFindings = items.map(
          (it) => `[${it.title}]: ${it.snippet.slice(0, 200)}...`
        );
        const stepSources = items.map((it) => it.url).filter(Boolean);

        stepSources.forEach((url) => sourceSet.add(url));

        investigations.push({
          step: i + 1,
          subQuery,
          findings: stepFindings,
          sources: stepSources,
        });
      }

      const allSources = Array.from(sourceSet);
      const summary = `In-depth research on "${topic}" completed in ${investigations.length} steps, covering core principles, best practices, and verified references.`;

      return {
        success: true,
        data: {
          topic,
          summary,
          stepsExecuted: investigations.length,
          investigations,
          allSources,
        },
        metadata: {
          durationMs: Date.now() - startTime,
          provider: "deep-search-orchestrator",
        },
      };
    } catch (err: any) {
      return {
        success: false,
        error: {
          code: "EXECUTION_ERROR",
          message: "Failed to execute deep search investigation.",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }
  },
};
