import { db } from "@/lib/db";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import type { ModelOption } from "@/types";

export interface ApiModelItem extends ModelOption {
  provider: {
    slug: string;
    name: string;
    logoKey: string;
    logoUrl: string | null;
  };
  contextWindow: number | null;
  maxOutputTokens: number | null;
  capabilities: {
    vision: boolean;
    tools: boolean;
    reasoning: boolean;
  };
}

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    // Q2: composer model list: SELECT ... FROM catalog_models WHERE status = 'active' ORDER BY sort_order
    // NEVER expose gateway_id, upstream_models, API keys, or baseUrl to this response!
    const models = await db.catalogModel.findMany({
      where: {
        status: "active",
      },
      orderBy: {
        sortOrder: "asc",
      },
      include: {
        provider: {
          select: {
            slug: true,
            name: true,
            logoKey: true,
            logoUrl: true,
          },
        },
      },
    });

    const items: ApiModelItem[] = models.map((m) => {
      // Map category to UI "Powerful" | "Fast"
      const category: "Powerful" | "Fast" =
        m.category.toLowerCase() === "fast" ? "Fast" : "Powerful";

      // Meta string e.g. "200k" or "128k" based on context window
      const meta = m.contextWindow
        ? `${Math.round(m.contextWindow / 1000)}k`
        : m.badge ?? category;

      return {
        id: m.publicId, // public catalog ID, e.g. "openai/gpt-6-luna" or "claude-sonnet-4-5"
        shortName: m.shortName,
        fullName: m.displayName,
        meta,
        description: m.description ?? "",
        category,
        badge: m.badge,
        provider: {
          slug: m.provider.slug,
          name: m.provider.name,
          logoKey: m.provider.logoKey,
          logoUrl: m.provider.logoUrl,
        },
        contextWindow: m.contextWindow,
        maxOutputTokens: m.maxOutputTokens,
        capabilities: {
          vision: m.supportsVision,
          tools: m.supportsTools,
          reasoning: m.supportsReasoning,
        },
      };
    });

    return jsonSuccess({ models: items }, { requestId });
  } catch (err) {
    console.error(`[MODELS_LIST_ERROR] [${requestId}]`, err);
    return jsonError(err, { requestId });
  }
}
