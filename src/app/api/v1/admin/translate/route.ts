import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess, ApiError } from "@/lib/api/response";
import { executeWithFallback } from "@/lib/routing/executor";
import { LOCALES, type Locale } from "@/lib/i18n/locales";

/**
 * Translates a short admin-written UI string (e.g. a plan feature) into the
 * other supported languages, through the normal smart-routing gateway and the
 * admin-configured default model. The admin reviews the result before saving.
 */
const localeCodes = LOCALES.map((l) => l.code) as [Locale, ...Locale[]];

const bodySchema = z.object({
  text: z.string().trim().min(1).max(500),
  source: z.enum(localeCodes),
  targets: z.array(z.enum(localeCodes)).min(1).max(localeCodes.length),
});

/** Pulls the JSON object out of the reply, tolerating code fences or stray prose. */
function parseTranslations(raw: string, targets: Locale[]): Partial<Record<Locale, string>> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
    const out: Partial<Record<Locale, string>> = {};
    for (const code of targets) {
      const value = obj[code];
      if (typeof value === "string" && value.trim()) out[code] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    const admin = await requireAdmin();

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid translate payload", parsed.error.format());
    }
    const { text, source } = parsed.data;
    const targets = [...new Set(parsed.data.targets)].filter((code) => code !== source);
    if (targets.length === 0) {
      return jsonSuccess({ translations: {} }, { requestId });
    }

    // Fallback order for translation: prefer auto router if configured, else let resolver pick settings.defaultModel
    const nameOf = (code: Locale) => LOCALES.find((l) => l.code === code)?.nativeName ?? code;
    const stream = executeWithFallback({
      publicModelId: "devnuby/auto",
      requestId,
      userId: admin.id,
      request: {
        messages: [
          {
            role: "system",
            content: [
              "You translate short UI strings for a SaaS pricing page.",
              "Keep the meaning, tone and length close to the source; keep numbers, units, symbols and product names unchanged.",
              "Keep placeholders in curly braces such as {value} or {base} exactly as written.",
              `Reply with ONLY a JSON object whose keys are exactly: ${targets.map((c) => `"${c}"`).join(", ")}.`,
              "No code fences, no explanations.",
            ].join(" "),
          },
          {
            role: "user",
            content: `Source language: ${nameOf(source)} (${source})\nTarget languages: ${targets
              .map((c) => `${nameOf(c)} (${c})`)
              .join(", ")}\nText: ${text}`,
          },
        ],
        maxTokens: 400,
        temperature: 0.2,
      },
    });

    let reply = "";
    for await (const event of stream) {
      if (event.type === "delta") reply += event.text;
    }

    const translations = parseTranslations(reply, targets);
    if (Object.keys(translations).length === 0) {
      throw ApiError.internal("The model did not return a usable translation. Try again.");
    }

    return jsonSuccess({ translations }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
