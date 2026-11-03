import { parseModelList, type DiscoveredModel } from "@/lib/oauth/model-capabilities";
import { ANTIGRAVITY_PROJECT_HEADER, ANTIGRAVITY_USER_AGENT } from "@/lib/oauth/constants/antigravity";
import { buildAntigravityEnvelope, createAntigravityParser } from "./adapters/antigravity";
import { parseSseStream } from "./sse";
import type { ModelPingResult } from "./provider-models-service";

/** Cloud Code Assist model catalogue: POST, not the OpenAI-style GET /models. */
export const ANTIGRAVITY_MODELS_URL = "https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels";
const PING_URL = "https://daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse";

function upstreamHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
    "User-Agent": ANTIGRAVITY_USER_AGENT,
  };
}

function errorText(text: string, status: number): string {
  try {
    const json = JSON.parse(text) as { error?: { message?: string } };
    if (json.error?.message) return json.error.message;
  } catch {
    // not JSON
  }
  return text.slice(0, 160) || `HTTP ${status}`;
}

export function isAntigravityPlaceholderModel(modelKey: string): boolean {
  return /^MODEL_PLACEHOLDER_/i.test(modelKey.trim());
}

export async function discoverAntigravityModels(
  auth: { accessToken: string; headers: Record<string, string> }
): Promise<{ supported: boolean; models: DiscoveredModel[]; warning?: string }> {
  const projectId = auth.headers[ANTIGRAVITY_PROJECT_HEADER];
  try {
    const res = await fetch(ANTIGRAVITY_MODELS_URL, {
      method: "POST",
      redirect: "manual",
      headers: upstreamHeaders(auth.accessToken),
      body: JSON.stringify(projectId ? { project: projectId } : {}),
      signal: AbortSignal.timeout(12000),
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      return { supported: false, models: [], warning: `fetchAvailableModels returned HTTP ${res.status}: ${errorText(text, res.status)}` };
    }
    // Shape: { models: { "<public id>": { model: "MODEL_PLACEHOLDER_…", displayName, isInternal, ... } } }.
    // The map KEY is the id inference accepts; the inner `model` field is Google's internal name,
    // so it is moved aside before the generic parser (which prefers `model` over the key) sees it.
    const json = JSON.parse(text || "{}") as { models?: unknown };
    const map = json.models && typeof json.models === "object" && !Array.isArray(json.models)
      ? (json.models as Record<string, Record<string, unknown>>)
      : null;
    const keyed = map
      ? {
          models: Object.fromEntries(
            Object.entries(map).map(([key, info]) => {
              const { model: internalModel, ...rest } = info ?? {};
              return [key, { ...rest, id: key, ...(internalModel ? { internalModel } : {}) }];
            })
          ),
        }
      : json;

    const models = parseModelList(keyed).filter((m) => m.raw?.isInternal !== true);
    return { supported: true, models };
  } catch (err) {
    return { supported: false, models: [], warning: err instanceof Error ? err.message : "Network error discovering models" };
  }
}

/** Sends "hi" through the real inference envelope and waits for the first streamed text. */
export async function pingAntigravityModel(
  auth: { accessToken: string; headers: Record<string, string> },
  modelKey: string
): Promise<ModelPingResult> {
  if (isAntigravityPlaceholderModel(modelKey)) {
    return {
      modelKey,
      success: false,
      httpStatus: 400,
      latencyMs: 0,
      error: `Model '${modelKey}' is a private internal Google placeholder and cannot be invoked.`,
    };
  }

  const envelope = buildAntigravityEnvelope(
    { model: modelKey, messages: [{ role: "user", content: "hi" }], maxTokens: 16 },
    auth.headers[ANTIGRAVITY_PROJECT_HEADER] ?? ""
  );
  const start = Date.now();
  try {
    const res = await fetch(PING_URL, {
      method: "POST",
      redirect: "manual",
      headers: { ...upstreamHeaders(auth.accessToken), Accept: "text/event-stream" },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(20000),
    });
    const latencyMs = Date.now() - start;
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      return { modelKey, success: false, httpStatus: res.status, latencyMs, error: errorText(text, res.status) };
    }

    const parse = createAntigravityParser();
    let preview = "";
    for await (const record of parseSseStream(res.body)) {
      for (const event of parse(record)) {
        if (event.type === "delta" || event.type === "reasoning") preview += event.text;
      }
      if (preview) break;
    }
    return { modelKey, success: true, httpStatus: res.status, latencyMs, outputPreview: (preview || "OK").slice(0, 80) };
  } catch (err) {
    return {
      modelKey,
      success: false,
      httpStatus: null,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "Ping request failed",
    };
  }
}
