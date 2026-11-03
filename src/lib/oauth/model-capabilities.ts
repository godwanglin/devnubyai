export type Modality = "text" | "image" | "video" | "audio" | "file";

export interface ModelCapabilities {
  reasoning: boolean;
  vision: boolean;
  tools: boolean;
  input: Modality[];
  output: Modality[];
  contextLength: number | null;
  maxOutputTokens: number | null;
  /** "upstream" when read from provider metadata, "heuristic" when guessed from the model id */
  source: "upstream" | "heuristic";
}

export interface DiscoveredModel {
  modelKey: string;
  displayName: string;
  ownedBy: string | null;
  capabilities: ModelCapabilities;
  raw: Record<string, unknown> | null;
}

const MODALITIES: Modality[] = ["text", "image", "video", "audio", "file"];

function toModality(value: unknown): Modality | null {
  if (typeof value !== "string") return null;
  const v = value.toLowerCase();
  if (v === "speech" || v === "voice") return "audio";
  if (v === "pdf" || v === "document") return "file";
  return (MODALITIES as string[]).includes(v) ? (v as Modality) : null;
}

function modalityList(value: unknown): Modality[] | null {
  if (!Array.isArray(value)) return null;
  const list = [...new Set(value.map(toModality).filter((m): m is Modality => m !== null))];
  return list.length > 0 ? list : null;
}

function positiveNumber(...values: unknown[]): number | null {
  for (const v of values) {
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n === "number" && Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function bool(...values: unknown[]): boolean | null {
  for (const v of values) if (typeof v === "boolean") return v;
  return null;
}

/** Best guess from the model id when upstream gives no metadata. */
export function inferCapabilitiesFromId(modelKey: string): ModelCapabilities {
  const id = modelKey.toLowerCase();
  const isImageGen = /imagine-image|image-gen|-image-|^grok-2-image|dall-e|image$/.test(id) && !/vision/.test(id);
  const isVideoGen = /video/.test(id);
  const isAudio = /tts|speech|audio|voice|realtime/.test(id);
  const nonReasoning = /non-reasoning/.test(id);
  const reasoning =
    !nonReasoning &&
    !isImageGen &&
    !isVideoGen &&
    (/reasoning|thinking|grok-build|grok-code|grok-[3-9](?:\.\d+)?-mini|grok-[4-9]|claude-3-7|claude-opus-5|claude-sonnet-5|claude-fable/.test(id) || /-(low|medium|high|xhigh)$/.test(id));
  const vision = !isImageGen && !isVideoGen && (/vision|grok-[4-9]|claude-[3-9]/.test(id) || /-vl\b/.test(id));

  let output: Modality[] = ["text"];
  if (isImageGen) output = ["image"];
  else if (isVideoGen) output = ["video"];
  else if (isAudio) output = ["audio"];

  const input: Modality[] = ["text"];
  if (vision || isVideoGen) input.push("image");

  return {
    reasoning,
    vision,
    tools: !isImageGen && !isVideoGen && !isAudio,
    input,
    output,
    contextLength: null,
    maxOutputTokens: null,
    source: "heuristic",
  };
}

/** Reads capability fields from a /models (or /language-models) item, falling back to the id heuristic. */
export function detectCapabilities(modelKey: string, raw: Record<string, unknown> | null): ModelCapabilities {
  const guess = inferCapabilitiesFromId(modelKey);
  if (!raw) return guess;

  const caps = (raw.capabilities && typeof raw.capabilities === "object" ? raw.capabilities : {}) as Record<
    string,
    unknown
  >;
  const arch = (raw.architecture && typeof raw.architecture === "object" ? raw.architecture : {}) as Record<
    string,
    unknown
  >;

  const input =
    modalityList(raw.input_modalities) ??
    modalityList(raw.inputModalities) ??
    modalityList(arch.input_modalities) ??
    modalityList(caps.input) ??
    null;
  const output =
    modalityList(raw.output_modalities) ??
    modalityList(raw.outputModalities) ??
    modalityList(arch.output_modalities) ??
    modalityList(caps.output) ??
    null;

  const reasoningFlag = bool(
    raw.supports_reasoning,
    raw.supportsReasoning,
    raw.reasoning,
    caps.reasoning,
    caps.thinking,
    raw.supports_reasoning_effort
  );
  const visionFlag = bool(raw.supports_vision, raw.supportsVision, raw.vision, caps.vision);
  const toolsFlag = bool(
    raw.supports_tools,
    raw.supportsTools,
    raw.supports_function_calling,
    caps.tools,
    caps.function_calling
  );

  const contextLength = positiveNumber(
    raw.context_length,
    raw.contextLength,
    raw.context_window,
    raw.contextWindow,
    raw.max_prompt_length
  );
  const maxOutputTokens = positiveNumber(raw.max_output_tokens, raw.maxOutputTokens, raw.max_completion_tokens);

  const fromUpstream =
    input !== null || output !== null || reasoningFlag !== null || visionFlag !== null || toolsFlag !== null;

  const finalInput = input ?? guess.input;
  return {
    reasoning: reasoningFlag ?? guess.reasoning,
    vision: visionFlag ?? (input ? input.includes("image") : guess.vision),
    tools: toolsFlag ?? guess.tools,
    input: finalInput,
    output: output ?? guess.output,
    contextLength,
    maxOutputTokens,
    source: fromUpstream ? "upstream" : "heuristic",
  };
}

/** Normalizes the many /models response shapes (data / models / results / map) into one list. */
export function parseModelList(json: unknown): DiscoveredModel[] {
  const root = json as Record<string, unknown> | unknown[] | null;
  let entries: Array<[string | null, unknown]> = [];
  const value = Array.isArray(root)
    ? root
    : (root as Record<string, unknown> | null)?.data ??
      (root as Record<string, unknown> | null)?.models ??
      (root as Record<string, unknown> | null)?.results ??
      [];
  if (Array.isArray(value)) entries = value.map((item) => [null, item]);
  else if (value && typeof value === "object") entries = Object.entries(value as Record<string, unknown>);

  const seen = new Set<string>();
  const result: DiscoveredModel[] = [];
  for (const [key, rawItem] of entries) {
    const item = (typeof rawItem === "string" ? { id: rawItem } : rawItem) as Record<string, unknown> | null;
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const id = String(item.id ?? item.model_id ?? item.modelId ?? item.model ?? item.slug ?? key ?? item.name ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const displayName = String(item.display_name ?? item.displayName ?? item.name ?? id);
    result.push({
      modelKey: id,
      displayName: displayName === id ? id : displayName,
      ownedBy: typeof item.owned_by === "string" ? item.owned_by : null,
      capabilities: detectCapabilities(id, item),
      raw: item,
    });
  }
  return result;
}

/** Merge richer metadata (e.g. xAI /language-models) into the plain /models list by id. */
export function mergeModelLists(base: DiscoveredModel[], rich: DiscoveredModel[]): DiscoveredModel[] {
  const byId = new Map(base.map((m) => [m.modelKey, m]));
  for (const r of rich) {
    const existing = byId.get(r.modelKey);
    byId.set(
      r.modelKey,
      existing
        ? {
            ...existing,
            displayName: existing.displayName === existing.modelKey ? r.displayName : existing.displayName,
            capabilities: r.capabilities.source === "upstream" ? r.capabilities : existing.capabilities,
            raw: { ...(existing.raw ?? {}), ...(r.raw ?? {}) },
          }
        : r
    );
  }
  return [...byId.values()];
}
