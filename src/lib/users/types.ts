export interface AdminUserListItemDto {
  id: string;
  publicId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  status: string;
  statusReason: string | null;
  planId: string | null;
  planName: string | null;
  planSlug: string | null;
  hasPassword: boolean;
  hasChatPin: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  stats: {
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalRequests: number;
    activeSessionsCount: number;
    chatCount: number;
    projectCount: number;
  };
}

export interface AdminUserDetailDto extends AdminUserListItemDto {
  activeSessions: {
    id: string;
    createdAt: string;
    expiresAt: string;
    ipAddress: string | null;
    userAgent: string | null;
  }[];
  recentAudits: {
    id: string;
    action: string;
    actorName: string | null;
    createdAt: string;
    details: Record<string, unknown> | null;
  }[];
  recentTransactions: {
    id: string;
    amount: number;
    currency: string;
    status: string;
    planName: string | null;
    createdAt: string;
  }[];
}

export interface ListUsersFilter {
  page?: number;
  limit?: number;
  search?: string;
  role?: string;
  status?: string;
  planId?: string;
  sortBy?: "createdAt" | "lastLoginAt" | "name" | "email" | "usage";
  sortOrder?: "asc" | "desc";
}
