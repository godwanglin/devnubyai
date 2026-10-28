import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import { getActiveCatalogModels } from "@/lib/catalog/cache";
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
    // Return cached active catalog models to minimize DB hits on public endpoints
    const items = await getActiveCatalogModels();
    return jsonSuccess({ models: items }, { requestId });
  } catch (err) {
    console.error(`[MODELS_LIST_ERROR] [${requestId}]`, err);
    return jsonError(err, { requestId });
  }
}
