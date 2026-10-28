import type { ReasoningEffortVariant } from "@/lib/gateways/types";
import type { ReasoningLevel } from "@/types";

const REASONING_MAP: Record<ReasoningLevel, ReasoningEffortVariant> = {
  "0": "off",
  "1": "low",
  "2": "medium",
  "3": "high",
  "4": "xhigh",
};

/**
 * Maps the UI slider reasoning level ("0" | "1" | "2" | "3" | "4") to
 * the gateway reasoning variant ("off" | "low" | "medium" | "high" | "xhigh").
 */
export function mapReasoningEffort(level?: string | null): ReasoningEffortVariant | undefined {
  if (!level) return undefined;
  if (level in REASONING_MAP) {
    return REASONING_MAP[level as ReasoningLevel];
  }
  return undefined;
}
