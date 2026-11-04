import type { ChatMessageInput } from "@/lib/gateways/types";
import { executeWithFallback } from "@/lib/routing/executor";
import { getSafetySettings } from "./settings";

export interface SafetyVerdict {
  blocked: boolean;
  /** Short English label of the blocked category (for logs) */
  category: string | null;
  /** ISO 639-1 language of the user's message, for the refusal text */
  language: string;
}

const CLASSIFIER_TIMEOUT_MS = 12_000;
const MAX_CONTEXT_MESSAGES = 4;
const MAX_CHARS_PER_MESSAGE = 2_000;

const CLASSIFIER_PROMPT = [
  "You are the safety gate of Devnuby AI, a chat assistant that can also write files and run shell commands inside a private, isolated Linux sandbox that belongs to the user (it cannot reach the host server, other users, the platform's databases, or internal networks; public internet is allowed).",
  "Classify ONLY the latest user message (earlier messages are context). Decide whether carrying it out would be illegal or seriously harmful.",
  "",
  "BLOCK when it clearly asks for:",
  "- creating, improving or deploying malware, ransomware, keyloggers, botnets, cryptominers or phishing kits",
  "- attacking, scanning, exploiting, brute-forcing or DDoS-ing systems the user does not own, or credential stuffing",
  "- breaking out of the sandbox, gaining root, or reaching the host, other users' data, the platform's databases, secrets or internal network",
  "- deliberately exhausting or crashing the server (fork bombs, memory or disk bombs)",
  "- stealing or dumping passwords, tokens, personal data or payment data; cracking passwords or hashes that are not the user's",
  "- cracking software, bypassing DRM, licensing or paywalls; piracy",
  "- fraud, scams, money laundering, forged documents or IDs, cheating payment systems",
  "- weapons, explosives, or synthesis of illegal drugs",
  "- sexual content involving minors; doxxing, stalking, harassment or threats",
  "",
  "ALLOW everything else, including: normal chat, coding, documents, data analysis; running ordinary commands in the user's own sandbox (listing files, `ps`, `env`, `df`, installing packages, downloading public files, checking whether something is reachable); security education, defensive or conceptual questions; fiction without operational instructions.",
  "When unsure, ALLOW.",
  "",
  'Reply with one line of JSON only: {"verdict":"allow"|"block","category":"<short english label or empty>","language":"<ISO 639-1 code of the latest user message>"}',
].join("\n");

function messageText(message: ChatMessageInput): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function parseVerdict(raw: string): SafetyVerdict | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const verdict = String(parsed.verdict ?? "").toLowerCase();
    if (verdict !== "allow" && verdict !== "block") return null;
    const language = String(parsed.language ?? "").toLowerCase().slice(0, 5) || "id";
    const category = String(parsed.category ?? "").trim().slice(0, 80) || null;
    return { blocked: verdict === "block", category, language };
  } catch {
    return null;
  }
}

/**
 * Asks the admin-configured classifier model whether the latest user request is illegal
 * or seriously harmful, before anything is sent to the chat model. Returns null when the
 * gate is off or the classifier fails (fail-open: an outage must not block every chat).
 */
export async function screenUserRequest(options: {
  conversation: ChatMessageInput[];
  requestId: string;
  userId: bigint;
  signal?: AbortSignal;
}): Promise<SafetyVerdict | null> {
  const { classifierModelId } = await getSafetySettings();
  if (!classifierModelId) return null;

  const recent = options.conversation
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-MAX_CONTEXT_MESSAGES);
  if (recent.length === 0 || recent[recent.length - 1].role !== "user") return null;

  const transcript = recent
    .map((m, i) => {
      const label = i === recent.length - 1 ? "LATEST USER MESSAGE" : m.role === "user" ? "User" : "Assistant";
      return `### ${label}\n${messageText(m).slice(0, MAX_CHARS_PER_MESSAGE)}`;
    })
    .join("\n\n");

  const timeout = AbortSignal.timeout(CLASSIFIER_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  try {
    let output = "";
    for await (const event of executeWithFallback({
      publicModelId: classifierModelId,
      requestId: `${options.requestId}:safety`,
      userId: options.userId,
      request: {
        messages: [
          { role: "system", content: CLASSIFIER_PROMPT },
          { role: "user", content: transcript },
        ],
        maxTokens: 300,
        temperature: 0,
        signal,
      },
    })) {
      if (event.type === "delta") output += event.text;
    }
    const verdict = parseVerdict(output);
    if (!verdict) console.warn(`[SAFETY_GATE_UNPARSED] [${options.requestId}]`, output.slice(0, 200));
    return verdict;
  } catch (err) {
    if (options.signal?.aborted) throw err;
    console.warn(`[SAFETY_GATE_FAILED] [${options.requestId}]`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Fixed refusal shown instead of a model reply when the gate blocks a request. */
export function buildSafetyRefusal(language: string): string {
  if (language.startsWith("id") || language.startsWith("ms")) {
    return "Maaf, permintaan ini tidak bisa saya proses karena mengarah ke aktivitas yang ilegal atau berbahaya. Kalau ada maksud lain, coba jelaskan kebutuhanmu dengan cara berbeda.";
  }
  return "Sorry, I can't help with this request because it points to illegal or harmful activity. If you meant something else, try describing what you need differently.";
}
