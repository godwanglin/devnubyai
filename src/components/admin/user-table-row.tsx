"use client";

import React from "react";
import { ShieldCheck, ShieldAlert, Eye, Pencil, Trash2, ScrollText } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import type { AdminUserListItemDto } from "@/lib/users/types";

export interface UserTableRowProps {
  user: AdminUserListItemDto;
  onDetail: (userId: string) => void;
  onViewLogs: (user: AdminUserListItemDto) => void;
  onEdit: (user: AdminUserListItemDto) => void;
  onDelete: (user: AdminUserListItemDto) => void;
  t: (key: string) => string;
}

export function UserTableRow({
  user: u,
  onDetail,
  onViewLogs,
  onEdit,
  onDelete,
  t,
}: UserTableRowProps) {
  const isActive = u.status === "active";

  return (
    <tr key={u.id} className="transition-colors hover:bg-[var(--hover)]/40">
      {/* User info */}
      <td className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--primary)]/10 text-xs font-bold text-[var(--primary)]">
            {u.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-xs text-[var(--ink)] truncate max-w-[200px]">
              {u.name}
            </div>
            <div className="text-[11px] text-[var(--muted)] truncate max-w-[200px]">
              {u.email}
            </div>
            <div className="font-mono text-[9px] text-[var(--muted)] mt-0.5">
              {u.publicId.slice(0, 13)}...
            </div>
          </div>
        </div>
      </td>

      {/* Role */}
      <td className="px-4 py-3.5">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
            u.role === "admin"
              ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
              : "bg-[var(--hover)] text-[var(--muted)] border border-[var(--border)]"
          )}
        >
          {u.role === "admin" && <ShieldCheck className="h-3 w-3" />}
          {u.role}
        </span>
      </td>

      {/* Plan */}
      <td className="px-4 py-3.5">
        <span className="inline-block rounded-[6px] border border-[var(--border)] bg-[var(--panel)] px-2 py-0.5 text-xs font-medium text-[var(--ink)]">
          {u.planName || "Free Plan"}
        </span>
      </td>

      {/* Status */}
      <td className="px-4 py-3.5">
        <div className="flex flex-col items-start gap-1">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border",
              isActive
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400"
            )}
          >
            {isActive ? t("admin.users.statusActive") : t("admin.users.statusDeactivated")}
          </span>
          {!isActive && u.statusReason && (
            <span
              title={u.statusReason}
              className="max-w-[140px] truncate text-[10px] text-[var(--muted)] flex items-center gap-1"
            >
              <ShieldAlert className="h-2.5 w-2.5 text-rose-500 shrink-0" />
              {u.statusReason}
            </span>
          )}
        </div>
      </td>

      {/* Activity */}
      <td className="px-4 py-3.5 text-xs text-[var(--muted)]">
        <div>
          {u.lastLoginAt ? (
            <span>{new Date(u.lastLoginAt).toLocaleDateString("id-ID")}</span>
          ) : (
            <span className="italic text-[10px]">{t("admin.users.neverLoggedIn")}</span>
          )}
        </div>
        <div className="text-[10px] text-[var(--muted)] mt-0.5">
          Dibuat: {new Date(u.createdAt).toLocaleDateString("id-ID")}
        </div>
      </td>

      {/* Usage & Sessions */}
      <td className="px-4 py-3.5 text-xs">
        <div className="font-medium text-[var(--ink)]">
          {new Intl.NumberFormat("id-ID").format(
            u.stats.totalPromptTokens + u.stats.totalCompletionTokens
          )}{" "}
          token
        </div>
        <div className="text-[10px] text-emerald-500 font-medium mt-0.5">
          {u.stats.activeSessionsCount} sesi aktif
        </div>
      </td>

      {/* Actions */}
      <td className="px-4 py-3.5 text-right">
        <div className="inline-flex items-center gap-1">
          <Tooltip content="Lihat Log Request (.logs/)">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => onViewLogs(u)}
              className="hover:text-[var(--primary)]"
            >
              <ScrollText className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip content={t("admin.users.viewDetail")}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => onDetail(u.id)}
            >
              <Eye className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip content={t("admin.users.editUser")}>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => onEdit(u)}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </Tooltip>
          <Tooltip content={t("admin.users.deleteUser")}>
            <Button
              type="button"
              variant="danger"
              size="icon-sm"
              onClick={() => onDelete(u)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
      </td>
    </tr>
  );
}
