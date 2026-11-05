import { XAI_DEFAULT_HEADERS } from "@/lib/oauth/constants/xai";
import { ANTIGRAVITY_PROJECT_HEADER } from "@/lib/oauth/constants/antigravity";
import { buildCodexImageBody, buildCodexImageHeaders, codexResponsesUrl, codexSizeFor, parseCodexImageStream } from "./codex";

/**
 * Wire adapters for upstream image generation. Pure mechanism: the gateway base URL,
 * model key, and account credentials always come from the DB-resolved candidate.
 */

export interface UpstreamImageAuth {
  accessToken: string;
  headers: Record<string, string>;
  baseUrl: string;
}

export interface UpstreamImageResult {
  buffer: Buffer;
  mimeType: string;
}

/** Upstream HTTP failure, keeps the status so the executor can classify it. */
export class ImageUpstreamError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
    readonly bodyText = ""
  ) {
    super(message);
    this.name = "ImageUpstreamError";
  }
}

export interface ImageAdapterOptions {
  signal?: AbortSignal;
  /** Target dimensions; adapters that honor a size pass the closest one upstream */
  aspectRatio?: string;
  resolution?: string;
  transparentBackground?: boolean;
}

type ImageAdapter = (
  auth: UpstreamImageAuth,
  modelKey: string,
  prompt: string,
  options?: ImageAdapterOptions
) => Promise<UpstreamImageResult>;

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

/** Internal x-devnuby-* routing headers never leave the server. */
function outboundHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).filter(([key]) => !key.toLowerCase().startsWith("x-devnuby-"))
  );
}

async function readUpstreamError(res: Response, label: string): Promise<ImageUpstreamError> {
  const text = await res.text().catch(() => "");
  let message = `HTTP ${res.status}`;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string };
    const detail = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
    if (detail) message = `${message}: ${detail}`;
  } catch {
    // body is not JSON
  }
  return new ImageUpstreamError(`${label} image generation failed (${message})`, res.status, text);
}

/** Pulls the first inlineData image part out of a Cloud Code SSE stream body. */
function extractInlineImage(sseBody: string): UpstreamImageResult | null {
  for (const line of sseBody.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(line.slice(5).trim());
    } catch {
      continue;
    }
    const candidates = (payload as { response?: { candidates?: unknown[] } })?.response?.candidates ?? [];
    for (const candidate of candidates) {
      const parts = (candidate as { content?: { parts?: unknown[] } })?.content?.parts ?? [];
      for (const part of parts) {
        const inline = (part as { inlineData?: { mimeType?: string; data?: string } }).inlineData;
        if (inline?.data) {
          return { buffer: Buffer.from(inline.data, "base64"), mimeType: inline.mimeType || "image/png" };
        }
      }
    }
  }
  return null;
}

/** Google Cloud Code Assist (Antigravity): Gemini image models via streamGenerateContent. */
const generateImageAntigravity: ImageAdapter = async (auth, modelKey, prompt, options) => {
  const projectId = auth.headers[ANTIGRAVITY_PROJECT_HEADER];
  if (!projectId) {
    throw new ImageUpstreamError("Antigravity account has no Cloud Code project id", null);
  }

  const res = await fetch(joinUrl(auth.baseUrl, "/v1internal:streamGenerateContent?alt=sse"), {
    method: "POST",
    headers: {
      ...outboundHeaders(auth.headers),
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      project: projectId,
      model: modelKey,
      request: {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      },
    }),
    signal: options?.signal,
  });
  if (!res.ok) throw await readUpstreamError(res, "Antigravity");

  const image = extractInlineImage(await res.text());
  if (!image) throw new ImageUpstreamError("Antigravity returned no image part", res.status);
  return image;
};

/** xAI (Grok Imagine): OpenAI-compatible /images/generations. */
const generateImageXai: ImageAdapter = async (auth, modelKey, prompt, options) => {
  const res = await fetch(joinUrl(auth.baseUrl, "/images/generations"), {
    method: "POST",
    headers: {
      ...XAI_DEFAULT_HEADERS,
      ...outboundHeaders(auth.headers),
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: modelKey, prompt, n: 1, response_format: "b64_json" }),
    signal: options?.signal,
  });
  if (!res.ok) throw await readUpstreamError(res, "xAI");

  const json = (await res.json().catch(() => ({}))) as { data?: Array<{ b64_json?: string }> };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new ImageUpstreamError("xAI returned no b64_json image", res.status);
  return { buffer: Buffer.from(b64, "base64"), mimeType: "image/jpeg" };
};

/**
 * ChatGPT Codex (OpenAI OAuth): the Responses API with an `image_generation` tool.
 * The model key keeps its `-image` suffix in the catalog; the request strips it.
 */
const generateImageOpenAi: ImageAdapter = async (auth, modelKey, prompt, options) => {
  const body = buildCodexImageBody({
    // The chat models pick their own framing unless the prompt states the ratio
    prompt: withAspectHint(prompt, options?.aspectRatio, options?.resolution),
    modelKey,
    size: codexSizeFor(options?.aspectRatio, options?.resolution),
    outputFormat: "png",
    background: options?.transparentBackground ? "transparent" : undefined,
    signal: options?.signal,
  });

  const res = await fetch(codexResponsesUrl(auth.baseUrl), {
    method: "POST",
    headers: buildCodexImageHeaders(outboundHeaders(auth.headers), auth.accessToken),
    body: JSON.stringify(body),
    signal: options?.signal,
  });
  if (!res.ok) throw await readUpstreamError(res, "OpenAI");

  const parsed = parseCodexImageStream(await res.text());
  if (!parsed.image) {
    const detail = parsed.error || parsed.text.slice(0, 300) || "no image part";
    throw new ImageUpstreamError(`OpenAI returned no image (${detail})`, res.status);
  }
  return parsed.image;
};

/** Appends the requested ratio as a sentence; the model reads it, the crop fixes the rest. */
function withAspectHint(prompt: string, aspectRatio?: string, resolution?: string): string {
  const res = resolution?.trim().match(/^(\d{2,4})[xX*](\d{2,4})$/);
  const ratio = res ? `${res[1]}:${res[2]}` : aspectRatio && /^\d+:\d+$/.test(aspectRatio) ? aspectRatio : null;
  if (!ratio) return prompt;
  const orientation = (() => {
    const [w, h] = ratio.split(":").map(Number);
    return w > h ? "landscape" : w < h ? "portrait" : "square";
  })();
  return `${prompt}\n\nCompose the image as a ${orientation} picture with a ${ratio} aspect ratio.`;
}

/** Wire protocol per OAuth provider; providers missing here cannot serve image routes. */
const IMAGE_ADAPTERS: Record<string, ImageAdapter> = {
  antigravity: generateImageAntigravity,
  xai: generateImageXai,
  openai: generateImageOpenAi,
};

export function getImageAdapter(oauthProvider: string | null): ImageAdapter | null {
  return oauthProvider ? IMAGE_ADAPTERS[oauthProvider] ?? null : null;
}
