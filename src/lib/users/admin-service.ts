import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { recordAdminAudit } from "@/lib/admin/audit";
import { hashPassword } from "@/lib/auth/password";
import type { Prisma } from "@/generated/client";
import type {
  AdminUserListItemDto,
  AdminUserDetailDto,
  ListUsersFilter,
} from "./types";

export const createAdminUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(320),
  password: z.string().min(6).optional().nullable(),
  role: z.enum(["user", "admin"]).default("user"),
  status: z.enum(["active", "deactivated", "suspended"]).default("active"),
  statusReason: z.string().trim().max(500).optional().nullable(),
  planId: z.string().optional().nullable(),
});

export const updateAdminUserSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().trim().email().max(320).optional(),
  role: z.enum(["user", "admin"]).optional(),
  status: z.enum(["active", "deactivated", "suspended"]).optional(),
  statusReason: z.string().trim().max(500).optional().nullable(),
  planId: z.string().optional().nullable(),
  newPassword: z.string().min(6).optional().nullable(),
  resetChatPin: z.boolean().optional(),
});

export type CreateAdminUserInput = z.infer<typeof createAdminUserSchema>;
export type UpdateAdminUserInput = z.infer<typeof updateAdminUserSchema>;

function parseUserId(idOrPublicId: string): { id?: bigint; publicId?: string } {
  if (/^\d+$/.test(idOrPublicId)) {
    return { id: BigInt(idOrPublicId) };
  }
  return { publicId: idOrPublicId };
}

export async function listAdminUsers(filter: ListUsersFilter = {}): Promise<{
  users: AdminUserListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const page = Math.max(1, filter.page ?? 1);
  const limit = Math.min(100, Math.max(1, filter.limit ?? 20));
  const skip = (page - 1) * limit;

  const where: Prisma.UserWhereInput = {};

  if (filter.search?.trim()) {
    const q = filter.search.trim();
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { publicId: { contains: q, mode: "insensitive" } },
    ];
  }

  if (filter.role && filter.role !== "all") {
    where.role = filter.role;
  }

  if (filter.status && filter.status !== "all") {
    where.status = filter.status;
  }

  if (filter.planId && filter.planId !== "all") {
    where.planId = filter.planId === "none" ? null : BigInt(filter.planId);
  }

  let orderBy: Prisma.UserOrderByWithRelationInput = { createdAt: "desc" };
  if (filter.sortBy === "lastLoginAt") {
    orderBy = { lastLoginAt: filter.sortOrder ?? "desc" };
  } else if (filter.sortBy === "name") {
    orderBy = { name: filter.sortOrder ?? "asc" };
  } else if (filter.sortBy === "email") {
    orderBy = { email: filter.sortOrder ?? "asc" };
  } else if (filter.sortBy === "createdAt") {
    orderBy = { createdAt: filter.sortOrder ?? "desc" };
  }

  const [total, userRows] = await Promise.all([
    db.user.count({ where }),
    db.user.findMany({
      where,
      skip,
      take: limit,
      orderBy,
      include: {
        plan: { select: { id: true, name: true, slug: true } },
        _count: {
          select: {
            chatSessions: true,
            projects: true,
            authSessions: true,
          },
        },
        usagePeriods: {
          select: {
            promptTokens: true,
            completionTokens: true,
            requestCount: true,
          },
        },
      },
    }),
  ]);

  const users: AdminUserListItemDto[] = userRows.map((u) => {
    let totalPrompt = 0;
    let totalComp = 0;
    let totalReq = 0;
    for (const p of u.usagePeriods) {
      totalPrompt += Number(p.promptTokens);
      totalComp += Number(p.completionTokens);
      totalReq += p.requestCount;
    }

    return {
      id: u.id.toString(),
      publicId: u.publicId,
      email: u.email,
      name: u.name,
      avatarUrl: u.avatarUrl,
      role: u.role,
      status: u.status,
      statusReason: u.statusReason,
      planId: u.planId ? u.planId.toString() : null,
      planName: u.plan?.name ?? null,
      planSlug: u.plan?.slug ?? null,
      hasPassword: Boolean(u.passwordHash),
      hasChatPin: Boolean(u.chatPinHash),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      updatedAt: u.updatedAt.toISOString(),
      stats: {
        totalPromptTokens: totalPrompt,
        totalCompletionTokens: totalComp,
        totalRequests: totalReq,
        activeSessionsCount: u._count.authSessions,
        chatCount: u._count.chatSessions,
        projectCount: u._count.projects,
      },
    };
  });

  return {
    users,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function getAdminUserDetail(
  idOrPublicId: string
): Promise<AdminUserDetailDto> {
  const where = parseUserId(idOrPublicId);
  const u = await db.user.findFirst({
    where,
    include: {
      plan: { select: { id: true, name: true, slug: true } },
      _count: {
        select: {
          chatSessions: true,
          projects: true,
          authSessions: true,
        },
      },
      authSessions: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          ipAddress: true,
          userAgent: true,
        },
      },
      usagePeriods: {
        select: {
          promptTokens: true,
          completionTokens: true,
          requestCount: true,
        },
      },
      transactions: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  if (!u) {
    throw ApiError.notFound("User tidak ditemukan");
  }

  const audits = await db.adminAuditLog.findMany({
    where: {
      entityType: "user",
      entityId: u.id.toString(),
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { actor: { select: { name: true, email: true } } },
  });

  let totalPrompt = 0;
  let totalComp = 0;
  let totalReq = 0;
  for (const p of u.usagePeriods) {
    totalPrompt += Number(p.promptTokens);
    totalComp += Number(p.completionTokens);
    totalReq += p.requestCount;
  }

  return {
    id: u.id.toString(),
    publicId: u.publicId,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    role: u.role,
    status: u.status,
    statusReason: u.statusReason,
    planId: u.planId ? u.planId.toString() : null,
    planName: u.plan?.name ?? null,
    planSlug: u.plan?.slug ?? null,
    hasPassword: Boolean(u.passwordHash),
    hasChatPin: Boolean(u.chatPinHash),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
    stats: {
      totalPromptTokens: totalPrompt,
      totalCompletionTokens: totalComp,
      totalRequests: totalReq,
      activeSessionsCount: u._count.authSessions,
      chatCount: u._count.chatSessions,
      projectCount: u._count.projects,
    },
    activeSessions: u.authSessions.map((s) => ({
      id: s.id.toString(),
      createdAt: s.createdAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
    })),
    recentAudits: audits.map((a) => ({
      id: a.id.toString(),
      action: a.action,
      actorName: a.actor?.name ?? a.actor?.email ?? null,
      createdAt: a.createdAt.toISOString(),
      details: a.afterState as Record<string, unknown> | null,
    })),
    recentTransactions: u.transactions.map((t) => ({
      id: t.id.toString(),
      amount: t.amount,
      currency: t.currency,
      status: t.status,
      planName: ((t.metadata as Record<string, unknown> | null)?.planName as string) ?? null,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}

export async function createAdminUser(
  input: CreateAdminUserInput,
  actorUserId: bigint
): Promise<AdminUserListItemDto> {
  const normalizedEmail = input.email.trim().toLowerCase();

  const existing = await db.user.findUnique({
    where: { email: normalizedEmail },
  });
  if (existing) {
    throw ApiError.conflict("Email sudah terdaftar pada pengguna lain");
  }

  let passwordHash: string | undefined = undefined;
  if (input.password?.trim()) {
    passwordHash = hashPassword(input.password.trim());
  }

  const planId = input.planId ? BigInt(input.planId) : null;

  const newUser = await db.user.create({
    data: {
      name: input.name.trim(),
      email: normalizedEmail,
      role: input.role,
      status: input.status,
      statusReason: input.statusReason?.trim() || null,
      planId,
      passwordHash,
    },
    include: {
      plan: { select: { id: true, name: true, slug: true } },
    },
  });

  await recordAdminAudit({
    actorUserId,
    action: "create",
    entityType: "user",
    entityId: newUser.id.toString(),
    afterState: {
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      status: newUser.status,
      planId: newUser.planId ? newUser.planId.toString() : null,
    },
  });

  return {
    id: newUser.id.toString(),
    publicId: newUser.publicId,
    email: newUser.email,
    name: newUser.name,
    avatarUrl: newUser.avatarUrl,
    role: newUser.role,
    status: newUser.status,
    statusReason: newUser.statusReason,
    planId: newUser.planId ? newUser.planId.toString() : null,
    planName: newUser.plan?.name ?? null,
    planSlug: newUser.plan?.slug ?? null,
    hasPassword: Boolean(newUser.passwordHash),
    hasChatPin: Boolean(newUser.chatPinHash),
    lastLoginAt: null,
    createdAt: newUser.createdAt.toISOString(),
    updatedAt: newUser.updatedAt.toISOString(),
    stats: {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalRequests: 0,
      activeSessionsCount: 0,
      chatCount: 0,
      projectCount: 0,
    },
  };
}

export async function updateAdminUser(
  idOrPublicId: string,
  input: UpdateAdminUserInput,
  actorUserId: bigint
): Promise<AdminUserListItemDto> {
  const where = parseUserId(idOrPublicId);
  const user = await db.user.findFirst({ where });
  if (!user) {
    throw ApiError.notFound("User tidak ditemukan");
  }

  const updateData: Prisma.UserUpdateInput = {};

  if (input.name !== undefined) updateData.name = input.name.trim();
  if (input.email !== undefined) {
    const normalized = input.email.trim().toLowerCase();
    if (normalized !== user.email) {
      const dup = await db.user.findUnique({ where: { email: normalized } });
      if (dup) throw ApiError.conflict("Email sudah digunakan oleh user lain");
      updateData.email = normalized;
    }
  }

  if (input.role !== undefined) updateData.role = input.role;

  let deactivating = false;
  if (input.status !== undefined) {
    updateData.status = input.status;
    if (input.status !== "active") {
      deactivating = true;
      updateData.statusReason = input.statusReason?.trim() || "Dinonaktifkan oleh administrator";
    } else {
      updateData.statusReason = null;
    }
  }

  if (input.planId !== undefined) {
    if (input.planId === null || input.planId === "" || input.planId === "none") {
      updateData.plan = { disconnect: true };
    } else {
      updateData.plan = { connect: { id: BigInt(input.planId) } };
    }
  }

  if (input.newPassword?.trim()) {
    updateData.passwordHash = hashPassword(input.newPassword.trim());
  }

  if (input.resetChatPin) {
    updateData.chatPinHash = null;
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: updateData,
    include: {
      plan: { select: { id: true, name: true, slug: true } },
      _count: {
        select: {
          chatSessions: true,
          projects: true,
          authSessions: true,
        },
      },
    },
  });

  // If status changed to inactive/suspended, revoke active sessions immediately
  if (deactivating) {
    await db.authSession.deleteMany({ where: { userId: user.id } });
  }

  await recordAdminAudit({
    actorUserId,
    action: "update",
    entityType: "user",
    entityId: user.id.toString(),
    beforeState: {
      role: user.role,
      status: user.status,
      statusReason: user.statusReason,
      planId: user.planId ? user.planId.toString() : null,
    },
    afterState: {
      role: updated.role,
      status: updated.status,
      statusReason: updated.statusReason,
      planId: updated.planId ? updated.planId.toString() : null,
      sessionsRevoked: deactivating,
      pinReset: Boolean(input.resetChatPin),
      passwordChanged: Boolean(input.newPassword),
    },
  });

  return {
    id: updated.id.toString(),
    publicId: updated.publicId,
    email: updated.email,
    name: updated.name,
    avatarUrl: updated.avatarUrl,
    role: updated.role,
    status: updated.status,
    statusReason: updated.statusReason,
    planId: updated.planId ? updated.planId.toString() : null,
    planName: updated.plan?.name ?? null,
    planSlug: updated.plan?.slug ?? null,
    hasPassword: Boolean(updated.passwordHash),
    hasChatPin: Boolean(updated.chatPinHash),
    lastLoginAt: updated.lastLoginAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
    stats: {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalRequests: 0,
      activeSessionsCount: updated._count.authSessions,
      chatCount: updated._count.chatSessions,
      projectCount: updated._count.projects,
    },
  };
}

export async function revokeAdminUserSessions(
  idOrPublicId: string,
  actorUserId: bigint
): Promise<{ revokedCount: number }> {
  const where = parseUserId(idOrPublicId);
  const user = await db.user.findFirst({ where, select: { id: true, email: true } });
  if (!user) throw ApiError.notFound("User tidak ditemukan");

  const result = await db.authSession.deleteMany({ where: { userId: user.id } });

  await recordAdminAudit({
    actorUserId,
    action: "revoke_sessions",
    entityType: "user",
    entityId: user.id.toString(),
    afterState: { revokedCount: result.count, userEmail: user.email },
  });

  return { revokedCount: result.count };
}

export async function resetAdminUserQuota(
  idOrPublicId: string,
  actorUserId: bigint
): Promise<{ success: boolean }> {
  const where = parseUserId(idOrPublicId);
  const user = await db.user.findFirst({ where, select: { id: true, email: true } });
  if (!user) throw ApiError.notFound("User tidak ditemukan");

  await Promise.all([
    db.userUsageWindow.deleteMany({ where: { userId: user.id } }),
    db.userUsagePeriod.deleteMany({ where: { userId: user.id } }),
  ]);

  await recordAdminAudit({
    actorUserId,
    action: "reset_quota",
    entityType: "user",
    entityId: user.id.toString(),
    afterState: { userEmail: user.email },
  });

  return { success: true };
}

export async function deleteAdminUser(
  idOrPublicId: string,
  actorUserId: bigint
): Promise<{ success: boolean }> {
  const where = parseUserId(idOrPublicId);
  const user = await db.user.findFirst({ where, select: { id: true, email: true } });
  if (!user) throw ApiError.notFound("User tidak ditemukan");

  if (user.id === actorUserId) {
    throw ApiError.badRequest("Anda tidak dapat menghapus akun Anda sendiri");
  }

  await db.user.delete({ where: { id: user.id } });

  await recordAdminAudit({
    actorUserId,
    action: "delete",
    entityType: "user",
    entityId: user.id.toString(),
    beforeState: { userEmail: user.email },
  });

  return { success: true };
}
