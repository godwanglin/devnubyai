import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";
import { validateSafeUrl } from "./ssrf";

export interface WebSearchParams {
  query: string;
  numResults?: number;
}

export interface WebSearchResultItem {
  title: string;
  url: string;
  snippet: string;
  source: string;
}

export interface WebSearchData {
  query: string;
  results: WebSearchResultItem[];
  totalResults: number;
}

async function performSearch(
  query: string,
  numResults: number,
  signal?: AbortSignal
): Promise<WebSearchResultItem[]> {
  const tavilyApiKey = process.env.TAVILY_API_KEY;

  if (!tavilyApiKey) {
    throw new Error(
      "TAVILY_API_KEY is not configured in the environment. Please add it to your .env file."
    );
  }

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: tavilyApiKey,
      query,
      max_results: numResults,
      search_depth: "basic",
      include_answer: false,
    }),
    signal,
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Tavily search API responded with status ${res.status}: ${errorText || res.statusText}`);
  }

  const json = await res.json();
  return (json.results || []).map((item: any) => ({
    title: item.title || "Untitled",
    url: item.url || "",
    snippet: item.content || item.snippet || "",
    source: "tavily",
  }));
}

export const webSearchTool: ToolDefinition<WebSearchParams, WebSearchData> = {
  name: "web_search",
  description:
    "Searches the web for up-to-date information, real-time facts, technical documentation, or online references. Always cite the exact source URLs in your answer using markdown links [Source Title or Domain](url) next to the facts.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The specific and concise search query.",
      },
      numResults: {
        type: "number",
        description: "Number of search results to return (min: 1, max: 10, default: 5).",
        default: 5,
      },
    },
    required: ["query"],
  },
  execute: async (
    params: WebSearchParams,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult<WebSearchData>> => {
    const startTime = Date.now();

    const trimmedQuery = (params.query || "").trim();
    if (!trimmedQuery) {
      return {
        success: false,
        error: {
          code: "INVALID_PARAM",
          message: "Parameter 'query' cannot be empty.",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }

    const count = Math.min(Math.max(params.numResults || 5, 1), 10);

    try {
      const results = await performSearch(trimmedQuery, count, context.signal);

      const safeResults = results.filter((item) => {
        if (!item.url) return false;
        return validateSafeUrl(item.url).safe;
      });

      return {
        success: true,
        data: {
          query: trimmedQuery,
          results: safeResults,
          totalResults: safeResults.length,
        },
        metadata: {
          durationMs: Date.now() - startTime,
          provider: process.env.TAVILY_API_KEY ? "tavily" : "mock-preview",
        },
      };
    } catch (err: any) {
      return {
        success: false,
        error: {
          code: "EXECUTION_ERROR",
          message: "Failed to perform web search request.",
        },
        metadata: { durationMs: Date.now() - startTime },
      };
    }
  },
};
