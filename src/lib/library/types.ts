/** "generated" covers everything the AI produced (session_files.source = "tool") */
export type LibraryFileSource = "upload" | "generated";

export interface LibraryFileChat {
  id: string;
  title: string;
  isArchived: boolean;
  projectId: string | null;
  projectName: string | null;
}

export interface LibraryFileDto {
  id: string;
  filename: string;
  displayName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  source: LibraryFileSource;
  isImage: boolean;
  url: string;
  createdAt: string;
  chat: LibraryFileChat;
}

export interface LibraryResponseDto {
  files: LibraryFileDto[];
  /** More files exist than were returned (only the most recent are listed) */
  truncated: boolean;
}
