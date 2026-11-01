"use client";

import React from "react";
import { FileText, Upload, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/providers/i18n-provider";
import type { ProjectFileDto } from "@/lib/projects/types";

export interface ProjectSourcesListProps {
  projectId: string;
  files: ProjectFileDto[];
  onAddSource?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProjectSourcesList({
  files,
  onAddSource,
}: ProjectSourcesListProps) {
  const { t } = useI18n();

  return (
    <div className="space-y-4">
      {/* Knowledge Note Card */}
      <div className="flex items-start justify-between gap-3 p-3.5 rounded-[12px] bg-[var(--panel-elevated)] border border-[var(--border)] text-xs text-[var(--muted)] leading-relaxed">
        <div className="flex items-start gap-2.5">
          <Upload className="w-4 h-4 shrink-0 text-[var(--accent)] mt-0.5" />
          <p className="flex-1">
            File yang Anda tambahkan di sini akan menjadi sumber pengetahuan bersama (knowledge base)
            yang otomatis dipahami dan dirujuk oleh AI dalam setiap percakapan di proyek ini.
          </p>
        </div>
        {files.length > 0 && onAddSource && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onAddSource}
            className="rounded-[8px] text-xs h-7 px-2.5 inline-flex items-center gap-1 shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t("projects.addSourceButton")}</span>
          </Button>
        )}
      </div>

      {files.length === 0 ? (
        <div className="py-10 text-center space-y-2 border border-dashed border-[var(--border)] rounded-[14px]">
          <div className="grid place-items-center w-10 h-10 rounded-full bg-[var(--panel-elevated)] text-[var(--placeholder)] mx-auto">
            <FileText className="w-5 h-5" />
          </div>
          <p className="text-sm font-medium text-[var(--ink)]">
            Belum ada sumber referensi
          </p>
          <p className="text-xs text-[var(--muted)] max-w-sm mx-auto">
            Unggah file PDF, Markdown, dokumen, atau kode untuk memperkaya pemahaman AI tentang proyek ini.
          </p>
          <div className="pt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onAddSource}
              className="rounded-[8px] text-xs h-8 px-3.5 inline-flex items-center gap-1.5 font-semibold bg-[var(--panel-elevated)] hover:bg-[var(--hover)] border border-[var(--border)] text-[var(--ink)]"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t("projects.addSourceButton")}</span>
            </Button>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-[var(--border)]">
          {files.map((file) => (
            <div
              key={file.id}
              className="flex items-center justify-between gap-3 py-3 px-2 rounded-[8px] hover:bg-[var(--hover)] transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <FileText className="w-4 h-4 text-[var(--accent)] shrink-0" />
                <span className="text-sm text-[var(--ink)] font-medium truncate">
                  {file.filename}
                </span>
              </div>
              <span className="text-xs text-[var(--placeholder)] shrink-0">
                {formatBytes(file.sizeBytes)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
