"use client";

import React, { useCallback, useEffect, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { cn } from "@/lib/cn";
import type { ChatErrorTraceDto } from "@/lib/logs/admin-service";

export function ChatErrorLogsView() {
  const { t } = useI18n();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ChatErrorTraceDto[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const fetchErrors = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/v1/admin/logs/chat-errors?${params.toString()}`, {
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message);
      setItems(json.data?.items ?? []);
      setTotal(json.data?.total ?? 0);
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : t("admin.logs.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, toast, t]);

  useEffect(() => {
    const timer = setTimeout(() => void fetchErrors(), 0);
    return () => clearTimeout(timer);
  }, [fetchErrors]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2.5 p-3 rounded-[12px] border border-[var(--border)] bg-[var(--panel)]">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--placeholder)] z-10 pointer-events-none" />
          <Input
            type="search"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder={t("admin.logs.errors.searchPlaceholder")}
            className="h-9 pl-8 pr-3 text-xs"
          />
        </div>
      </div>

      <div className="rounded-[12px] border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        {loading ? (
          <p className="px-4 py-8 text-center text-xs text-[var(--muted)]">{t("admin.logs.errors.loading")}</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-[var(--muted)]">{t("admin.logs.errors.empty")}</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {items.map((item) => {
              const open = openId === item.messageId;
              const requestId = item.requestId ?? "";
              return (
                <li key={item.messageId}>
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : item.messageId)}
                    aria-expanded={open}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[var(--hover)] transition-colors cursor-pointer"
                  >
                    <ChevronDown
                      className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted)] transition-transform", open && "rotate-180")}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="font-mono text-[11px] text-[var(--accent)]">{requestId || item.messageId}</span>
                        {item.errorCode ? (
                          <span className="rounded-[5px] bg-red-500/10 px-1.5 py-0.5 font-mono text-[10px] text-red-400">
                            {item.errorCode}
                          </span>
                        ) : null}
                        <span className="text-[11px] text-[var(--muted)]">
                          {item.userEmail ?? item.userName ?? ""}
                          {item.modelName ? ` · ${item.modelName}` : ""}
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-[12.5px] text-[var(--ink)]">
                        <span className="text-[var(--muted)]">{t("admin.logs.errors.clientSaw")}: </span>
                        {item.clientError}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] text-[var(--muted)]">
                      {new Date(item.createdAt).toLocaleString()}
                    </span>
                  </button>

                  {open ? (
                    <div className="space-y-2 px-4 pb-4 pl-10">
                      <p className="text-[11px] text-[var(--muted)]">
                        {t("admin.logs.errors.session")}: <span className="font-mono">{item.sessionId}</span>
                      </p>
                      <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-words rounded-[8px] border border-[var(--border)] bg-[var(--bg)] p-3 font-mono text-[11.5px] leading-relaxed text-[var(--ink)]">
                        {item.trace}
                      </pre>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <DataTablePagination
        page={page}
        pageSize={pageSize}
        totalItems={total}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPage(1);
          setPageSize(size);
        }}
      />
    </div>
  );
}
