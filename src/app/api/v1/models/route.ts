import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/session";
import { getActiveCatalogModelsForPlan } from "@/lib/catalog/cache";
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

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const user = await requireUser();
    // Model lock states strictly reflect the user's subscription plan access
    const items = await getActiveCatalogModelsForPlan(user.planId);
    return jsonSuccess(
      { models: items },
      {
        requestId,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (err) {
    console.error(`[MODELS_LIST_ERROR] [${requestId}]`, err);
    return jsonError(err, { requestId });
  }
}
