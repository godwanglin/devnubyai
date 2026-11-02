import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";

/**
 * Rolling 24-hour upload size quota per plan (in MB).
 * - "user": manual uploads (chat `source = "upload"` + project sources)
 * - "agent": files the AI agent writes to R2 (chat `source = "tool"`)
 * Empty / 0 on the plan means unlimited.
 */
export type UploadQuotaKind = "user" | "agent";

const WINDOW_MS = 86_400_000;
const MB = 1024 * 1024;

type UserRef = { userId: bigint } | { userPublicId: string };

function formatMb(bytes: number): string {
  return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
}

export async function assertUploadQuota(
  ref: UserRef,
  kind: UploadQuotaKind,
  incomingBytes: number
): Promise<void> {
  const user = await db.user.findUnique({
    where: "userId" in ref ? { id: ref.userId } : { publicId: ref.userPublicId },
    select: {
      id: true,
      plan: { select: { dailyUploadLimitMb: true, dailyAgentUploadLimitMb: true } },
    },
  });
  if (!user) throw ApiError.unauthorized("User account not found");

  const limitMb =
    kind === "user" ? user.plan?.dailyUploadLimitMb : user.plan?.dailyAgentUploadLimitMb;
  if (!limitMb || limitMb <= 0) return;

  const since = new Date(Date.now() - WINDOW_MS);
  const [sessionAgg, projectAgg] = await Promise.all([
    db.sessionFile.aggregate({
      where: { userId: user.id, createdAt: { gte: since }, source: kind === "user" ? "upload" : "tool" },
      _sum: { sizeBytes: true },
    }),
    kind === "user"
      ? db.projectFile.aggregate({
          where: { userId: user.id, createdAt: { gte: since } },
          _sum: { sizeBytes: true },
        })
      : Promise.resolve(null),
  ]);

  const usedBytes =
    Number(sessionAgg._sum.sizeBytes ?? 0) + Number(projectAgg?._sum.sizeBytes ?? 0);
  const limitBytes = limitMb * MB;

  if (usedBytes + incomingBytes > limitBytes) {
    const label = kind === "user" ? "Upload" : "Agent file";
    throw ApiError.rateLimited(
      `${label} limit reached for the last 24 hours (${formatMb(usedBytes)} / ${limitMb} MB used). Try again later or upgrade your plan.`
    );
  }
}

/** Tool-friendly variant: returns the quota error message instead of throwing (null = allowed). */
export async function checkAgentUploadQuota(
  userPublicId: string,
  incomingBytes: number
): Promise<string | null> {
  try {
    await assertUploadQuota({ userPublicId }, "agent", incomingBytes);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Agent upload limit reached.";
  }
}
