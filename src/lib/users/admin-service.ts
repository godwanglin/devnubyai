import { z } from "zod";
import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import { recordAdminAudit } from "@/lib/admin/audit";
import { hashPassword } from "@/lib/auth/password";
import { markUserSessionsRevoked } from "@/lib/auth/session";
import {
  invalidateUserQuotaCache,
  invalidateUserMeCache,
  invalidateUserSessionsCache,
} from "@/lib/redis/cache-keys";
import type { Prisma } from "@/generated/client";
import type {
  AdminUserListItemDto,
  AdminUserDetailDto,
  ListUsersFilter,
} from "./types";

export {
  createAdminUserSchema,
  updateAdminUserSchema,
  type CreateAdminUserInput,
  type UpdateAdminUserInput,
} from "./admin-schemas";
import { parseUserId, type CreateAdminUserInput, type UpdateAdminUserInput } from "./admin-schemas";

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
      planExpiresAt: u.planExpiresAt?.toISOString() ?? null,
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
    planExpiresAt: u.planExpiresAt?.toISOString() ?? null,
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
    planExpiresAt: null,
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

  // Same rule as delete: an admin can't lock themselves (and possibly everyone) out
  if (
    user.id === actorUserId &&
    ((input.role !== undefined && input.role !== user.role) ||
      (input.status !== undefined && input.status !== "active"))
  ) {
    throw ApiError.badRequest("Tidak dapat mengubah role atau menonaktifkan akun Anda sendiri");
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

  // Admin-set expiry for the assigned plan; null/empty = never expires
  if (input.planExpiresAt !== undefined) {
    updateData.planExpiresAt = input.planExpiresAt ? new Date(input.planExpiresAt) : null;
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

  // If status changed to inactive/suspended, or an admin reset the password,
  // revoke active sessions immediately
  const passwordReset = Boolean(input.newPassword?.trim()) && user.id !== actorUserId;
  if (deactivating || passwordReset) {
    await db.authSession.deleteMany({ where: { userId: user.id } });
    await markUserSessionsRevoked(user.id);
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

  await Promise.allSettled([
    invalidateUserMeCache(updated.id),
    invalidateUserQuotaCache(updated.id),
    ...(deactivating ? [invalidateUserSessionsCache(updated.id)] : []),
  ]);

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
    planExpiresAt: updated.planExpiresAt?.toISOString() ?? null,
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

export {
  revokeAdminUserSessions,
  resetAdminUserQuota,
  deleteAdminUser,
} from "./admin-actions";
