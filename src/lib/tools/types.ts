export interface ToolParameter {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required?: boolean;
  enum?: string[];
  default?: unknown;
  items?: Record<string, unknown>;
  properties?: Record<string, unknown>;
}

export interface ToolParametersSchema {
  type: "object";
  properties: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolExecutionContext {
  userId: string;
  sessionId: string;
  /** Internal ids, when the caller already has them (saves tools a lookup) */
  userInternalId?: bigint;
  sessionInternalId?: bigint;
  signal?: AbortSignal;
  model?: string;
  customConfig?: Record<string, unknown>;
  /** Live progress while the tool runs (e.g. a document file landing in the workspace) */
  onProgress?: (event: ToolProgressEvent) => void;
}

/** A document the running tool has written to the chat workspace, readable before the tool ends. */
export interface ToolProgressEvent {
  type: "document-ready";
  /** Workspace-relative path, e.g. `laporan.pdf` */
  path: string;
  sizeBytes: number;
  /** Changes on every rewrite, so previews can tell versions apart */
  version: number;
}

export interface ToolExecutionResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code:
      | "INVALID_PARAM"
      | "SSRF_BLOCKED"
      | "NOT_FOUND"
      | "STORAGE_ERROR"
      | "TIMEOUT"
      | "RATE_LIMITED"
      | "EXECUTION_ERROR";
    message: string;
    details?: unknown;
  };
  metadata?: {
    durationMs: number;
    provider?: string;
    tokensUsed?: number;
  };
}

export interface ToolDefinition<
  TParams = Record<string, any>,
  TResult = unknown
> {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
  execute: (
    params: TParams,
    context: ToolExecutionContext
  ) => Promise<ToolExecutionResult<TResult>>;
}
