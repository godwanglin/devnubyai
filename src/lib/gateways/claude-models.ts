import { validateSafeUrlResolved } from "@/lib/tools/ssrf";
import type { ModelPingResult } from "./provider-models-service";
import { isAdaptiveThinkingModel, isBudgetThinkingModel } from "./adapters/claude";

export async function pingClaudeModel(
  auth: { accessToken: string; headers: Record<string, string> },
  modelKey: string,
  baseUrl = "https://api.anthropic.com/v1"
): Promise<ModelPingResult> {
  const url = `${baseUrl}/messages?beta=true`;
  const ssrf = await validateSafeUrlResolved(url);
  if (!ssrf.safe) {
    return {
      modelKey,
      success: false,
      httpStatus: null,
      latencyMs: 0,
      error: `SSRF blocked: ${ssrf.reason}`,
    };
  }

  const isAdaptive = isAdaptiveThinkingModel(modelKey);
  const isBudget = isBudgetThinkingModel(modelKey);

  const body: Record<string, unknown> = {
    model: modelKey,
    max_tokens: 50,
    messages: [{ role: "user", content: "ping" }],
  };

  if (isAdaptive) {
    body.thinking = { type: "adaptive" };
  } else if (isBudget) {
    body.thinking = { type: "enabled", budget_tokens: 1024 };
    body.max_tokens = 2048;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
        ...auth.headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - start;
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = `HTTP ${res.status}`;
      try {
        const errJson = JSON.parse(text) as {
          type?: string;
          error?: { type?: string; message?: string } | string;
          message?: string;
        };
        const parsed =
          (typeof errJson.error === "object" ? errJson.error?.message : errJson.error) || errJson.message;
        const errType = typeof errJson.error === "object" ? errJson.error?.type : errJson.type;

        if (res.status === 429) {
          msg = `Anthropic rate limit: Model ${modelKey} is temporarily throttled upstream on this account (Claude Code allocation reached).`;
        } else if (parsed && parsed !== "Error") {
          msg = String(parsed);
        } else if (errType) {
          msg = `${errType}: ${parsed || "Request rejected upstream"}`;
        }
      } catch {
        if (text) msg = text.slice(0, 160);
      }
      return { modelKey, success: false, httpStatus: res.status, latencyMs, error: msg };
    }

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const content = Array.isArray(json.content) ? json.content : [];
    const textBlock = content.find(
      (c: unknown) => c && typeof c === "object" && (c as { type?: string }).type === "text"
    ) as { text?: string } | undefined;
    const outputPreview = textBlock?.text?.trim().slice(0, 60) || "OK";

    return { modelKey, success: true, httpStatus: res.status, latencyMs, outputPreview };
  } catch (err: unknown) {
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    return {
      modelKey,
      success: false,
      httpStatus: null,
      latencyMs,
      error: err instanceof Error ? err.message : "Request failed",
    };
  }
}
