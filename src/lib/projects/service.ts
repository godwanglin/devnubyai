import { db } from "@/lib/db";
import { ApiError } from "@/lib/api/response";
import type {
  ProjectDto,
  ProjectDetailDto,
  CreateProjectInput,
  UpdateProjectInput,
  ProjectRecentChat,
  ProjectFileDto,
} from "./types";

function formatRecentChat(chat: {
  publicId: string;
  title: string;
  isPinned: boolean;
  isLocked?: boolean;
  lastMessageAt: Date;
  messages?: Array<{ content: string }>;
}): ProjectRecentChat {
  return {
    id: chat.publicId,
    title: chat.title,
    isPinned: chat.isPinned,
    isLocked: Boolean(chat.isLocked),
    lastMessageAt: chat.lastMessageAt.toISOString(),
    preview: chat.messages?.[0]?.content?.slice(0, 120) || undefined,
  };
}

function formatProjectFile(file: {
  publicId: string;
  filename: string;
  mimeType: string;
  sizeBytes: bigint;
  createdAt: Date;
}): ProjectFileDto {
  return {
    id: file.publicId,
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: Number(file.sizeBytes),
    createdAt: file.createdAt.toISOString(),
  };
}

export async function listUserProjects(userId: bigint): Promise<ProjectDto[]> {
  const projects = await db.project.findMany({
    where: {
      userId,
      isArchived: false,
    },
    orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }],
    include: {
      _count: {
        select: { chatSessions: true },
      },
      chatSessions: {
        where: { isArchived: false },
        orderBy: [{ isPinned: "desc" }, { lastMessageAt: "desc" }],
        take: 5,
        select: {
          publicId: true,
          title: true,
          isPinned: true,
          isLocked: true,
          lastMessageAt: true,
          messages: {
            orderBy: { id: "desc" },
            take: 1,
            select: { content: true },
          },
        },
      },
    },
  });

  return projects.map((p) => ({
    id: p.publicId,
    name: p.name,
    description: p.description,
    customInstructions: p.customInstructions,
    isPinned: p.isPinned,
    isArchived: p.isArchived,
    shareToken: p.shareToken,
    sharedAt: p.sharedAt?.toISOString() || null,
    shareAccess: (p.shareAccess as "anyone" | "invited") || "anyone",
    invitedEmails: Array.isArray(p.invitedEmails) ? (p.invitedEmails as string[]) : [],
    chatCount: p._count.chatSessions,
    recentChats: p.chatSessions.map(formatRecentChat),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  }));
}

export async function createProject(
  userId: bigint,
  input: CreateProjectInput
): Promise<ProjectDto> {
  const name = input.name?.trim();
  if (!name) {
    throw ApiError.badRequest("Nama proyek tidak boleh kosong");
  }

  const project = await db.project.create({
    data: {
      userId,
      name,
      description: input.description?.trim() || null,
      customInstructions: input.customInstructions?.trim() || null,
    },
    include: {
      _count: {
        select: { chatSessions: true },
      },
    },
  });

  return {
    id: project.publicId,
    name: project.name,
    description: project.description,
    customInstructions: project.customInstructions,
    isPinned: project.isPinned,
    isArchived: project.isArchived,
    shareToken: project.shareToken,
    sharedAt: project.sharedAt?.toISOString() || null,
    shareAccess: (project.shareAccess as "anyone" | "invited") || "anyone",
    invitedEmails: [],
    chatCount: 0,
    recentChats: [],
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export async function getProjectDetail(
  userId: bigint,
  publicId: string
): Promise<ProjectDetailDto> {
  const project = await db.project.findFirst({
    where: { publicId, userId },
    include: {
      _count: {
        select: { chatSessions: true },
      },
      chatSessions: {
        where: { isArchived: false },
        orderBy: [{ isPinned: "desc" }, { lastMessageAt: "desc" }],
        select: {
          publicId: true,
          title: true,
          isPinned: true,
          isLocked: true,
          lastMessageAt: true,
          messages: {
            orderBy: { id: "desc" },
            take: 1,
            select: { content: true },
          },
        },
      },
      projectFiles: {
        orderBy: { createdAt: "desc" },
        select: {
          publicId: true,
          filename: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
      },
    },
  });

  if (!project) {
    throw ApiError.notFound("Proyek tidak ditemukan");
  }

  return {
    id: project.publicId,
    name: project.name,
    description: project.description,
    customInstructions: project.customInstructions,
    isPinned: project.isPinned,
    isArchived: project.isArchived,
    shareToken: project.shareToken,
    sharedAt: project.sharedAt?.toISOString() || null,
    shareAccess: (project.shareAccess as "anyone" | "invited") || "anyone",
    invitedEmails: Array.isArray(project.invitedEmails) ? (project.invitedEmails as string[]) : [],
    chatCount: project._count.chatSessions,
    recentChats: project.chatSessions.slice(0, 5).map(formatRecentChat),
    chats: project.chatSessions.map(formatRecentChat),
    files: project.projectFiles.map(formatProjectFile),
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export async function updateProject(
  userId: bigint,
  publicId: string,
  input: UpdateProjectInput
): Promise<ProjectDto> {
  const existing = await db.project.findFirst({
    where: { publicId, userId },
    select: { id: true },
  });

  if (!existing) {
    throw ApiError.notFound("Proyek tidak ditemukan");
  }

  const data: {
    name?: string;
    description?: string | null;
    customInstructions?: string | null;
    isPinned?: boolean;
    isArchived?: boolean;
  } = {};

  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) throw ApiError.badRequest("Nama proyek tidak boleh kosong");
    data.name = trimmed;
  }
  if (input.description !== undefined) {
    data.description = input.description?.trim() || null;
  }
  if (input.customInstructions !== undefined) {
    data.customInstructions = input.customInstructions?.trim() || null;
  }
  if (input.isPinned !== undefined) {
    data.isPinned = input.isPinned;
  }
  if (input.isArchived !== undefined) {
    data.isArchived = input.isArchived;
  }

  const updated = await db.project.update({
    where: { id: existing.id },
    data,
    include: {
      _count: {
        select: { chatSessions: true },
      },
      chatSessions: {
        where: { isArchived: false },
        orderBy: [{ isPinned: "desc" }, { lastMessageAt: "desc" }],
        take: 5,
        select: {
          publicId: true,
          title: true,
          isPinned: true,
          isLocked: true,
          lastMessageAt: true,
          messages: {
            orderBy: { id: "desc" },
            take: 1,
            select: { content: true },
          },
        },
      },
    },
  });

  return {
    id: updated.publicId,
    name: updated.name,
    description: updated.description,
    customInstructions: updated.customInstructions,
    isPinned: updated.isPinned,
    isArchived: updated.isArchived,
    shareToken: updated.shareToken,
    sharedAt: updated.sharedAt?.toISOString() || null,
    shareAccess: (updated.shareAccess as "anyone" | "invited") || "anyone",
    invitedEmails: Array.isArray(updated.invitedEmails) ? (updated.invitedEmails as string[]) : [],
    chatCount: updated._count.chatSessions,
    recentChats: updated.chatSessions.map(formatRecentChat),
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}

export async function deleteProject(
  userId: bigint,
  publicId: string,
  cascade = false
): Promise<void> {
  const existing = await db.project.findFirst({
    where: { publicId, userId },
    select: { id: true },
  });

  if (!existing) {
    throw ApiError.notFound("Proyek tidak ditemukan");
  }

  if (cascade) {
    // Cascade delete: project & all chats inside it
    await db.$transaction([
      db.chatSession.deleteMany({ where: { projectId: existing.id } }),
      db.projectFile.deleteMany({ where: { projectId: existing.id } }),
      db.project.delete({ where: { id: existing.id } }),
    ]);
  } else {
    // Default safe option: unlink all chats so they become regular root chats
    await db.$transaction([
      db.chatSession.updateMany({
        where: { projectId: existing.id },
        data: { projectId: null },
      }),
      db.projectFile.deleteMany({ where: { projectId: existing.id } }),
      db.project.delete({ where: { id: existing.id } }),
    ]);
  }
}

export async function moveChatToProject(
  userId: bigint,
  chatPublicId: string,
  targetProjectPublicId: string | null
): Promise<{ success: boolean; projectId: string | null }> {
  const chat = await db.chatSession.findFirst({
    where: { publicId: chatPublicId, userId },
    select: { id: true },
  });

  if (!chat) {
    throw ApiError.notFound("Percakapan tidak ditemukan");
  }

  let targetInternalId: bigint | null = null;
  if (targetProjectPublicId) {
    const targetProject = await db.project.findFirst({
      where: { publicId: targetProjectPublicId, userId },
      select: { id: true },
    });
    if (!targetProject) {
      throw ApiError.notFound("Proyek tujuan tidak ditemukan");
    }
    targetInternalId = targetProject.id;
  }

  await db.chatSession.update({
    where: { id: chat.id },
    data: { projectId: targetInternalId },
  });

  return { success: true, projectId: targetProjectPublicId };
}

export async function updateProjectShare(
  userId: bigint,
  publicId: string,
  options: {
    shareAccess?: "anyone" | "invited";
    invitedEmails?: string[];
  }
): Promise<{
  shareToken: string;
  shareUrl: string;
  shareAccess: "anyone" | "invited";
  invitedEmails: string[];
}> {
  const existing = await db.project.findFirst({
    where: { publicId, userId },
  });
  if (!existing) {
    throw ApiError.notFound("Proyek tidak ditemukan");
  }

  const token = existing.shareToken || crypto.randomUUID();
  const nextAccess =
    options.shareAccess ||
    (existing.shareAccess as "anyone" | "invited") ||
    "anyone";
  const nextEmails =
    options.invitedEmails !== undefined
      ? options.invitedEmails
      : Array.isArray(existing.invitedEmails)
        ? (existing.invitedEmails as string[])
        : [];

  await db.project.update({
    where: { id: existing.id },
    data: {
      shareToken: token,
      sharedAt: existing.sharedAt || new Date(),
      shareAccess: nextAccess,
      invitedEmails: nextEmails,
    },
  });

  return {
    shareToken: token,
    shareUrl: `/project/share/${token}`,
    shareAccess: nextAccess,
    invitedEmails: nextEmails,
  };
}

export async function revokeProjectShare(
  userId: bigint,
  publicId: string
): Promise<void> {
  const existing = await db.project.findFirst({
    where: { publicId, userId },
  });
  if (!existing) {
    throw ApiError.notFound("Proyek tidak ditemukan");
  }
  await db.project.update({
    where: { id: existing.id },
    data: {
      shareToken: null,
      sharedAt: null,
    },
  });
}
