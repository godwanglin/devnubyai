import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { recordAdminAudit } from "@/lib/admin/audit";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import {
  getNetworkRules,
  saveNetworkRules,
  DEFAULT_NETWORK_RULES,
} from "@/lib/network/network-rules";

const updateNetworkRulesSchema = z.object({
  allowlist: z.array(z.string().trim().min(1)).optional(),
  blocklist: z.array(z.string().trim().min(1)).optional(),
  resetToDefault: z.boolean().optional(),
});

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const rules = getNetworkRules();

    return jsonSuccess({ rules }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);

  try {
    const admin = await requireAdmin();

    const body = await request.json().catch(() => ({}));
    const parsed = updateNetworkRulesSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid network rules payload", parsed.error.format());
    }

    const currentRules = getNetworkRules();

    let updated;
    if (parsed.data.resetToDefault) {
      updated = await saveNetworkRules(DEFAULT_NETWORK_RULES);
    } else {
      updated = await saveNetworkRules({
        allowlist: parsed.data.allowlist,
        blocklist: parsed.data.blocklist,
      });
    }

    await recordAdminAudit({
      actorUserId: admin.id,
      action: "network_rules.update",
      entityType: "app_setting",
      entityId: "network_rules",
      beforeState: currentRules as unknown as Record<string, unknown>,
      afterState: updated as unknown as Record<string, unknown>,
    });

    return jsonSuccess({ rules: updated }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
