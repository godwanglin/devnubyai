"use client";

import React from "react";
import { DocxPagePreview } from "./docx-page-preview";
import { PdfFilePreview } from "./pdf-file-preview";

export interface DocumentPreviewProps {
  kind: "pdf" | "docx";
  bytes: ArrayBuffer;
  title: string;
  downloadUrl: string;
  fileId?: string;
  initialSearchQuery?: string;
}

export function DocumentPreview({
  kind,
  bytes,
  title,
  fileId,
  initialSearchQuery,
}: DocumentPreviewProps) {
  if (kind === "pdf") {
    return (
      <PdfFilePreview
        bytes={bytes}
        title={title}
        fileId={fileId}
        initialSearchQuery={initialSearchQuery}
      />
    );
  }

  return (
    <DocxPagePreview
      bytes={bytes}
      title={title}
      fileId={fileId}
      initialSearchQuery={initialSearchQuery}
    />
  );
}
