import { requireAdmin } from "@/lib/auth/session";
import { ApiError, getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";
import {
  getDokuPublicSettings,
  updateDokuSettings,
  getDokuConfig,
} from "@/lib/doku/settings";
import { dokuSettingsPatchSchema } from "@/lib/doku/schemas";
import { checkDokuOrderStatus, DokuApiError } from "@/lib/doku/client";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();
    const settings = await getDokuPublicSettings({ forceRefresh: true });
    return jsonSuccess({ settings }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

export async function PATCH(request: Request) {
  const requestId = getRequestId(request);

  try {
    const adminUser = await requireAdmin();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw ApiError.badRequest("Invalid JSON body");
    }

    const parsed = dokuSettingsPatchSchema.safeParse(body);
    if (!parsed.success) {
      throw ApiError.badRequest("Invalid DOKU settings payload", parsed.error.format());
    }

    const settings = await updateDokuSettings(parsed.data, adminUser.id);
    return jsonSuccess({ settings }, { requestId });
  } catch (err) {
    return jsonError(err, { requestId });
  }
}

/** Test DOKU credentials & connectivity endpoint */
export async function POST(request: Request) {
  const requestId = getRequestId(request);

  try {
    await requireAdmin();

    try {
      const body = (await request.json().catch(() => ({}))) as { action?: string };
      if (body.action && body.action !== "test_connection") {
        throw ApiError.badRequest(`Unsupported action: ${body.action}`);
      }
    } catch (err) {
      if (err instanceof ApiError) throw err;
    }

    const { config } = await getDokuConfig({ forceRefresh: true });

    if (!config.clientId || !config.secretKey) {
      throw ApiError.badRequest(
        "DOKU Client ID and Secret Key must be configured in settings or environment (.env) before testing"
      );
    }

    // Ping test using order status lookup with test identifier
    let testSuccess = false;
    let message = "DOKU credentials verified successfully";
    let details: unknown = null;

    try {
      const res = await checkDokuOrderStatus(config, "DEVNUBY-PING-CHECK");
      testSuccess = true;
      details = res;
    } catch (err) {
      if (err instanceof DokuApiError) {
        // HTTP 404 or order not found indicates signature & auth succeeded!
        if (
          err.status === 404 ||
          String(err.details).toLowerCase().includes("not found") ||
          String(err.message).toLowerCase().includes("not found")
        ) {
          testSuccess = true;
          message = "Authentication with DOKU succeeded (Signature and Client ID valid)";
          details = err.details;
        } else if (err.status === 401 || err.status === 403) {
          throw ApiError.badRequest("DOKU authentication failed: Invalid Client ID or Secret Key", err.details);
        } else {
          throw ApiError.badRequest(`DOKU test failed: ${err.message}`, err.details);
        }
      } else {
        throw ApiError.internal(
          err instanceof Error ? err.message : "Unexpected error during DOKU connection test"
        );
      }
    }

    return jsonSuccess(
      {
        success: testSuccess,
        message,
        environment: config.environment,
        clientId: config.clientId,
        details,
      },
      { requestId }
    );
  } catch (err) {
    return jsonError(err, { requestId });
  }
}
