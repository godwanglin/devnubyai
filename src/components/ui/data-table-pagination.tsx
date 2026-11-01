"use client";

import React, { useMemo } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CustomSelect } from "@/components/ui/custom-select";
import { useI18n } from "@/providers/i18n-provider";
import { cn } from "@/lib/cn";

export interface DataTablePaginationProps {
  page: number;
  pageSize: number;
  totalItems: number;
  pageSizeOptions?: number[];
  onPageChange: (newPage: number) => void;
  onPageSizeChange: (newPageSize: number) => void;
  disabled?: boolean;
  className?: string;
}

export function DataTablePagination({
  page,
  pageSize = 10,
  totalItems,
  pageSizeOptions = [10, 20, 50, 100],
  onPageChange,
  onPageSizeChange,
  disabled = false,
  className,
}: DataTablePaginationProps) {
  const { t } = useI18n();

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const from = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, totalItems);

  const selectOptions = useMemo(
    () =>
      pageSizeOptions.map((opt) => ({
        value: String(opt),
        label: String(opt),
      })),
    [pageSizeOptions]
  );

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-[var(--border)] bg-[var(--panel)] text-xs text-[var(--muted)]",
        className
      )}
    >
      {/* Left: CustomSelect Rows Per Page & Item Count */}
      <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] font-medium text-[var(--muted)] whitespace-nowrap">
            {t("admin.pagination.rowsPerPage")}
          </span>
          <div className="w-[78px]">
            <CustomSelect
              options={selectOptions}
              value={String(pageSize)}
              onChange={(val) => onPageSizeChange(Number(val))}
              disabled={disabled}
              size="sm"
            />
          </div>
        </div>

        <span className="text-[11.5px] whitespace-nowrap">
          {totalItems === 0 ? (
            "0 data"
          ) : (
            <>
              <strong className="text-[var(--ink)] font-semibold">
                {from}-{to}
              </strong>{" "}
              dari{" "}
              <strong className="text-[var(--ink)] font-semibold">
                {totalItems}
              </strong>
            </>
          )}
        </span>
      </div>

      {/* Right: Page Indicator & Navigation Buttons */}
      <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
        <span className="text-[11.5px] whitespace-nowrap">
          Halaman{" "}
          <strong className="text-[var(--ink)] font-semibold">{currentPage}</strong>{" "}
          dari{" "}
          <strong className="text-[var(--ink)] font-semibold">{totalPages}</strong>
        </span>

        <div className="flex items-center gap-1">
          {/* First page button */}
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || currentPage <= 1}
            onClick={() => onPageChange(1)}
            className="h-8 w-8 p-0"
            title={t("admin.pagination.first")}
            aria-label={t("admin.pagination.first")}
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>

          {/* Previous page button */}
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || currentPage <= 1}
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            className="h-8 w-8 p-0"
            title={t("admin.pagination.prev")}
            aria-label={t("admin.pagination.prev")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          {/* Next page button */}
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || currentPage >= totalPages}
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            className="h-8 w-8 p-0"
            title={t("admin.pagination.next")}
            aria-label={t("admin.pagination.next")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          {/* Last page button */}
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || currentPage >= totalPages}
            onClick={() => onPageChange(totalPages)}
            className="h-8 w-8 p-0"
            title={t("admin.pagination.last")}
            aria-label={t("admin.pagination.last")}
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
