import type { ReasoningEffortVariant } from "../types";

/**
 * Public Antigravity model ids -> the id Cloud Code Assist actually serves, plus the
 * thinking level carried by the id. Mirrors 9router's registry (`upstreamModelId`
 * "base(level)"): the "(level)" part is not sent, it becomes generationConfig.thinkingConfig.
 */

type ThinkingLevel = "low" | "medium" | "high";

export interface ResolvedAntigravityModel {
  upstreamModel: string;
  level: ThinkingLevel | null;
}

const LEVEL_TO_BUDGET: Record<ThinkingLevel, number> = { low: 1024, medium: 8192, high: 24576 };

const ALIASES: Array<{ pattern: RegExp; resolve: (m: RegExpMatchArray) => ResolvedAntigravityModel }> = [
  // Gemini 3.1 Pro (High) is served as the "gemini-pro-agent" model with no thinking preset
  { pattern: /^(?:gemini-3\.1-pro-high|gemini-pro-agent)$/, resolve: () => ({ upstreamModel: "gemini-pro-agent", level: null }) },
  // Gemini 3.6 / 3.7 Flash tiers share one "tiered" model
  {
    pattern: /^gemini-(3\.[67])-flash-(low|medium|high)$/,
    resolve: (m) => ({ upstreamModel: `gemini-${m[1]}-flash-tiered`, level: m[2] as ThinkingLevel }),
  },
  // Unsuffixed aliases default to a preset tier
  { pattern: /^gemini-3\.8-flash$/, resolve: () => ({ upstreamModel: "gemini-3.8-flash-medium", level: "medium" }) },
  {
    pattern: /^claude-(sonnet|opus)-5-5$/,
    resolve: (m) => ({ upstreamModel: `claude-${m[1]}-5-5-high`, level: "high" }),
  },
  // Tiered ids keep their name and carry the level in the suffix
  {
    pattern: /^((?:gemini|claude)-.+)-(low|medium|high)$/,
    resolve: (m) => ({ upstreamModel: `${m[1]}-${m[2]}`, level: m[2] as ThinkingLevel }),
  },
];

export function resolveAntigravityModel(rawModel: string): ResolvedAntigravityModel {
  const trimmed = rawModel.trim();
  // An explicit "model(level)" suffix wins over the alias table
  const suffix = trimmed.match(/^(.*)\((low|medium|high)\)\s*$/i);
  if (suffix) {
    return { upstreamModel: suffix[1].trim(), level: suffix[2].toLowerCase() as ThinkingLevel };
  }
  for (const { pattern, resolve } of ALIASES) {
    const match = trimmed.match(pattern);
    if (match) return resolve(match);
  }
  return { upstreamModel: trimmed, level: null };
}

function levelFromEffort(effort: ReasoningEffortVariant | undefined): ThinkingLevel | null {
  if (effort === "low" || effort === "medium" || effort === "high") return effort;
  if (effort === "xhigh") return "high";
  return null;
}

/** Output must leave room above the thinking budget, or Google rejects the request. */
function outputFloor(budget: number): number {
  if (budget <= 1024) return 8192;
  if (budget <= 8192) return 16384;
  return 32768;
}

/**
 * thinkingConfig + minimum maxOutputTokens, or null when no thinking applies.
 * The reasoning effort the user picked wins over the preset in the model id; the
 * model id itself is never rewritten, since not every model has every tier upstream.
 */
export function antigravityThinkingConfig(
  resolved: ResolvedAntigravityModel,
  effort: ReasoningEffortVariant | undefined
): { thinkingConfig: Record<string, unknown>; minOutputTokens: number } | null {
  // "off": send no thinkingConfig and let the model run on its own default
  if (effort === "off") return null;
  const level = levelFromEffort(effort) ?? resolved.level;
  if (!level) return null;
  const budget = LEVEL_TO_BUDGET[level];
  return { thinkingConfig: { thinkingBudget: budget, includeThoughts: true }, minOutputTokens: outputFloor(budget) };
}
