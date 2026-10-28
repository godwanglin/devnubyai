import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { uuidv7 } from "./uuidv7";

export const REQUEST_ID_HEADER = "x-request-id";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "UNPROCESSABLE_ENTITY"
  | "RATE_LIMITED"
  | "MODEL_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    requestId: string;
    details?: unknown;
  };
}

export interface ApiSuccessBody<T> {
  data: T;
  meta?: {
    nextCursor?: string | null;
    total?: number;
    [key: string]: unknown;
  };
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: ApiErrorCode;
  public readonly details?: unknown;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = "Bad request", details?: unknown): ApiError {
    return new ApiError(400, "BAD_REQUEST", message, details);
  }

  static unauthorized(message = "Authentication required"): ApiError {
    return new ApiError(401, "UNAUTHORIZED", message);
  }

  static forbidden(message = "Forbidden"): ApiError {
    return new ApiError(403, "FORBIDDEN", message);
  }

  static notFound(message = "Resource not found"): ApiError {
    return new ApiError(404, "NOT_FOUND", message);
  }

  static conflict(message = "Conflict", details?: unknown): ApiError {
    return new ApiError(409, "CONFLICT", message, details);
  }

  static rateLimited(message = "Too many requests"): ApiError {
    return new ApiError(429, "RATE_LIMITED", message);
  }

  static modelUnavailable(message = "The model is temporarily unavailable."): ApiError {
    return new ApiError(503, "MODEL_UNAVAILABLE", message);
  }

  static internal(message = "An unexpected error occurred"): ApiError {
    return new ApiError(500, "INTERNAL_ERROR", message);
  }
}

/**
 * Extract or generate a request ID from request headers.
 */
export function getRequestId(request?: Request | Headers | null): string {
  if (!request) return uuidv7();
  const headers = request instanceof Headers ? request : request.headers;
  const existing = headers.get(REQUEST_ID_HEADER) || headers.get("x-correlation-id");
  return existing && existing.trim().length > 0 ? existing.trim() : uuidv7();
}

/**
 * Uniform success response helper. Sets x-request-id.
 */
export function jsonSuccess<T>(
  data: T,
  init?: {
    status?: number;
    headers?: HeadersInit;
    requestId?: string;
    meta?: ApiSuccessBody<T>["meta"];
  }
): NextResponse<ApiSuccessBody<T>> {
  const reqId = init?.requestId ?? uuidv7();
  const headers = new Headers(init?.headers);
  headers.set(REQUEST_ID_HEADER, reqId);

  const body: ApiSuccessBody<T> = { data };
  if (init?.meta) {
    body.meta = init.meta;
  }

  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers,
  });
}

/**
 * Uniform error response helper. Sets x-request-id.
 */
export function jsonError(
  err: unknown,
  init?: {
    status?: number;
    requestId?: string;
    headers?: HeadersInit;
  }
): NextResponse<ApiErrorBody> {
  const reqId = init?.requestId ?? uuidv7();
  const headers = new Headers(init?.headers);
  headers.set(REQUEST_ID_HEADER, reqId);

  // 1. Zod validation error
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: {
          code: "UNPROCESSABLE_ENTITY",
          message: "Validation failed",
          requestId: reqId,
          details: err.flatten(),
        },
      },
      { status: 422, headers }
    );
  }

  // 2. Explicit ApiError
  if (err instanceof ApiError) {
    return NextResponse.json(
      {
        error: {
          code: err.code,
          message: err.message,
          requestId: reqId,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      },
      { status: err.status, headers }
    );
  }

  // 3. Fallback standard Error (no internal leaks to the client)
  const isDev = process.env.NODE_ENV !== "production";
  const fallbackMessage = isDev && err instanceof Error ? err.message : "An unexpected error occurred";

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: fallbackMessage,
        requestId: reqId,
      },
    },
    { status: init?.status ?? 500, headers }
  );
}

/**
 * Wrap a Route Handler function to catch uncaught errors uniformly and attach x-request-id.
 */
export function handleApi(
  handler: (req: Request, context: { requestId: string; [key: string]: unknown }) => Promise<Response>
): (req: Request, context: { [key: string]: unknown }) => Promise<Response> {
  return async (req: Request, context: { [key: string]: unknown }) => {
    const requestId = getRequestId(req);
    try {
      const response = await handler(req, { ...context, requestId });
      if (!response.headers.has(REQUEST_ID_HEADER)) {
        response.headers.set(REQUEST_ID_HEADER, requestId);
      }
      return response;
    } catch (err) {
      console.error(`[API_ERROR] [${requestId}]`, err);
      return jsonError(err, { requestId });
    }
  };
}
