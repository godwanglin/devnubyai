import { getSession } from "@/lib/auth/session";
import { getRequestId, jsonError, jsonSuccess } from "@/lib/api/response";

export async function GET(request: Request) {
  const requestId = getRequestId(request);

  try {
    const session = await getSession();

    // If user is not logged in, return null data so client can gracefully show guest/login state
    if (!session) {
      return jsonSuccess({ user: null }, { requestId });
    }

    const { user } = session;

    // Compute initials (e.g., "Aiden Lin" -> "AL")
    const initials =
      user.name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() || "")
        .join("") || "U";

    const responsePayload = {
      user: {
        id: user.publicId,
        name: user.name,
        email: user.email,
        initials,
        role: user.role,
        plan: user.plan?.slug ?? "free",
        planLabel: user.plan?.name ?? "Free Plan",
        avatarUrl: user.avatarUrl,
      },
    };

    return jsonSuccess(responsePayload, { requestId });
  } catch (err) {
    console.error(`[ME_ERROR] [${requestId}]`, err);
    return jsonError(err, { requestId });
  }
}
