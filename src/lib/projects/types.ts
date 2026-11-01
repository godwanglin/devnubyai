export interface ProjectRecentChat {
  id: string; // publicId
  title: string;
  isPinned: boolean;
  isLocked: boolean;
  lastMessageAt: string;
  preview?: string;
}

export interface ProjectDto {
  id: string; // publicId (UUIDv7)
  name: string;
  description: string | null;
  customInstructions: string | null;
  isPinned: boolean;
  isArchived: boolean;
  shareToken: string | null;
  sharedAt: string | null;
  shareAccess: "anyone" | "invited";
  invitedEmails: string[];
  chatCount: number;
  recentChats: ProjectRecentChat[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectFileDto {
  id: string; // publicId
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface ProjectDetailDto extends ProjectDto {
  chats: ProjectRecentChat[];
  files: ProjectFileDto[];
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  customInstructions?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string | null;
  customInstructions?: string | null;
  isPinned?: boolean;
  isArchived?: boolean;
}
