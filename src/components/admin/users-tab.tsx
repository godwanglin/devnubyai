"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  Search,
  RefreshCw,
  UserPlus,
  Download,
  Pencil,
  Eye,
  Trash2,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
} from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { cn } from "@/lib/cn";
import type { AdminUserListItemDto } from "@/lib/users/types";
import { UserEditModal } from "@/components/admin/user-edit-modal";
import { CreateUserModal } from "@/components/admin/create-user-modal";
import { UserDetailModal } from "@/components/admin/user-detail-modal";
import { CustomSelect } from "@/components/ui/custom-select";
import { ConfirmModal } from "@/components/modals/confirm-modal";

interface PlanOption {
  id: string;
  name: string;
  slug: string;
}

export function UsersTab() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [users, setUsers] = useState<AdminUserListItemDto[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [planFilter, setPlanFilter] = useState("all");

  // Modals state
  const [editingUser, setEditingUser] = useState<AdminUserListItemDto | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [detailUserId, setDetailUserId] = useState<string | null>(null);
  const [deletingUser, setDeletingUser] = useState<AdminUserListItemDto | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [, startTransition] = useTransition();

  // Load plans for dropdown
  useEffect(() => {
    async function loadPlans() {
      try {
        const res = await fetch("/api/v1/admin/plans");
        const data = await res.json();
        if (res.ok && data.data?.plans) {
          setPlans(data.data.plans.map((p: { id: string; name: string; slug: string }) => ({
            id: p.id,
            name: p.name,
            slug: p.slug,
          })));
        }
      } catch {
        // ignore
      }
    }
    void loadPlans();
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", page.toString());
      params.set("limit", "15");
      if (searchTerm) params.set("search", searchTerm);
      if (roleFilter !== "all") params.set("role", roleFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (planFilter !== "all") params.set("planId", planFilter);

      const res = await fetch(`/api/v1/admin/users?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Gagal memuat pengguna");

      setUsers(data.data.users);
      setTotal(data.data.total);
      setTotalPages(data.data.totalPages);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }, [page, searchTerm, roleFilter, statusFilter, planFilter]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams();
    params.set("page", page.toString());
    params.set("limit", "15");
    if (searchTerm) params.set("search", searchTerm);
    if (roleFilter !== "all") params.set("role", roleFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (planFilter !== "all") params.set("planId", planFilter);

    fetch(`/api/v1/admin/users?${params.toString()}`)
      .then((res) => res.json())
      .then((data) => {
        if (!active) return;
        if (data.data?.users) {
          setUsers(data.data.users);
          setTotal(data.data.total);
          setTotalPages(data.data.totalPages);
        } else {
          setError(data.error?.message || "Gagal memuat pengguna");
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Terjadi kesalahan");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [page, searchTerm, roleFilter, statusFilter, planFilter]);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    startTransition(() => {
      setSearchTerm(searchInput.trim());
    });
  }

  async function handleConfirmDelete() {
    if (!deletingUser) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/v1/admin/users/${deletingUser.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || "Gagal menghapus pengguna");
      toast(t("admin.users.deleteSuccess") || "Pengguna berhasil dihapus");
      setDeletingUser(null);
      void loadUsers();
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : "Gagal menghapus pengguna");
    } finally {
      setIsDeleting(false);
    }
  }

  function handleExportCsv() {
    if (users.length === 0) return;
    const headers = "ID,PublicID,Name,Email,Role,Status,StatusReason,Plan,LastLogin,CreatedAt";
    const rows = users.map((u) =>
      [u.id, u.publicId, `"${u.name.replace(/"/g, '""')}"`, u.email, u.role, u.status, `"${(u.statusReason || "").replace(/"/g, '""')}"`, u.planName || "Free", u.lastLoginAt || "", u.createdAt].join(",")
    );
    const blob = new Blob([[headers, ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `users_export_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-4 sm:p-6">
      {/* Top Header */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">{t("admin.users.title")}</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">{t("admin.users.description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void loadUsers()}
            disabled={loading}
            className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--border)] px-3 text-sm font-medium text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            <span className="hidden sm:inline">{t("admin.users.refresh")}</span>
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={users.length === 0}
            className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[var(--border)] px-3 text-sm font-medium text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{t("admin.users.exportCsv")}</span>
          </button>
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="inline-flex h-9 items-center gap-2 rounded-[8px] bg-[var(--primary)] px-3.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <UserPlus className="h-4 w-4" />
            <span>{t("admin.users.addUser")}</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col gap-3 rounded-[12px] border border-[var(--border)] bg-[var(--panel)] p-3.5 sm:flex-row sm:items-center sm:justify-between">
        <form onSubmit={handleSearchSubmit} className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-[var(--muted)]" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("admin.users.searchPlaceholder")}
            className="w-full rounded-[8px] border border-[var(--border)] bg-transparent py-2 pl-9 pr-3 text-xs text-[var(--ink)] placeholder:text-[var(--placeholder)] focus:border-[var(--primary)] focus:outline-none"
          />
        </form>

        <div className="flex flex-wrap items-center gap-2">
          {/* Role Filter */}
          <CustomSelect
            value={roleFilter}
            onChange={(val) => {
              setRoleFilter(val);
              setPage(1);
            }}
            options={[
              { value: "all", label: t("admin.users.allRoles") },
              { value: "user", label: t("admin.users.roleUser") },
              { value: "admin", label: t("admin.users.roleAdmin") },
            ]}
            className="w-[125px]"
            size="sm"
          />

          {/* Status Filter */}
          <CustomSelect
            value={statusFilter}
            onChange={(val) => {
              setStatusFilter(val);
              setPage(1);
            }}
            options={[
              { value: "all", label: t("admin.users.allStatuses") },
              { value: "active", label: t("admin.users.statusActive") },
              { value: "deactivated", label: t("admin.users.statusDeactivated") },
              { value: "suspended", label: t("admin.users.statusSuspended") },
            ]}
            className="w-[145px]"
            size="sm"
          />

          {/* Plan Filter */}
          <CustomSelect
            value={planFilter}
            onChange={(val) => {
              setPlanFilter(val);
              setPage(1);
            }}
            options={[
              { value: "all", label: t("admin.users.allPlans") },
              { value: "none", label: "Tanpa Paket" },
              ...plans.map((p) => ({ value: p.id, label: p.name })),
            ]}
            className="w-[145px]"
            size="sm"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-[10px] border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-500">
          {error}
        </div>
      )}

      {/* Users Table */}
      <div className="overflow-x-auto rounded-[12px] border border-[var(--border)] bg-[var(--panel)]">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-[var(--border)] bg-[var(--hover)]/50 text-[11px] uppercase tracking-wide text-[var(--muted)]">
            <tr>
              <th className="px-4 py-3">{t("admin.users.userCol")}</th>
              <th className="px-4 py-3">{t("admin.users.roleCol")}</th>
              <th className="px-4 py-3">{t("admin.users.planCol")}</th>
              <th className="px-4 py-3">{t("admin.users.statusCol")}</th>
              <th className="px-4 py-3">{t("admin.users.activityCol")}</th>
              <th className="px-4 py-3">{t("admin.users.usageCol")}</th>
              <th className="px-4 py-3 text-right">{t("admin.users.actionsCol")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {loading && users.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-xs text-[var(--muted)]">
                  {t("admin.users.loading")}
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-xs text-[var(--muted)]">
                  {t("admin.users.empty")}
                </td>
              </tr>
            ) : (
              users.map((u) => {
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
                        <button
                          type="button"
                          onClick={() => setDetailUserId(u.id)}
                          title={t("admin.users.viewDetail")}
                          className="rounded-[6px] p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingUser(u)}
                          title={t("admin.users.editUser")}
                          className="rounded-[6px] p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--ink)]"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingUser(u)}
                          title={t("admin.users.deleteUser")}
                          className="rounded-[6px] p-1.5 text-rose-500/80 transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-[var(--muted)] px-1">
          <div>
            {t("admin.users.pagination").replace("{from}", ((page - 1) * 15 + 1).toString()).replace("{to}", Math.min(page * 15, total).toString()).replace("{total}", total.toString())}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-[6px] border border-[var(--border)] p-1.5 disabled:opacity-40 hover:bg-[var(--hover)]"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-2">
              {t("admin.users.pageOf").replace("{page}", page.toString()).replace("{totalPages}", totalPages.toString())}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-[6px] border border-[var(--border)] p-1.5 disabled:opacity-40 hover:bg-[var(--hover)]"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {editingUser && (
        <UserEditModal
          user={editingUser}
          plans={plans}
          onClose={() => setEditingUser(null)}
          onSuccess={() => {
            setEditingUser(null);
            void loadUsers();
          }}
        />
      )}

      {isCreateOpen && (
        <CreateUserModal
          plans={plans}
          onClose={() => setIsCreateOpen(false)}
          onSuccess={() => {
            setIsCreateOpen(false);
            void loadUsers();
          }}
        />
      )}

      {detailUserId && (
        <UserDetailModal
          userId={detailUserId}
          onClose={() => setDetailUserId(null)}
          onRefreshParent={() => void loadUsers()}
        />
      )}

      {deletingUser && (
        <ConfirmModal
          isOpen={Boolean(deletingUser)}
          onClose={() => setDeletingUser(null)}
          onConfirm={handleConfirmDelete}
          title={t("admin.users.deleteUser")}
          description={`${t("admin.users.deleteConfirm")} ${deletingUser.name} (${deletingUser.email})?`}
          confirmLabel={t("admin.users.deleteUser")}
          cancelLabel={t("admin.users.cancel")}
          variant="danger"
          loading={isDeleting}
        />
      )}
    </div>
  );
}
