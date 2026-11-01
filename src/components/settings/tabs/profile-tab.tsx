"use client";

import React from "react";
import Link from "next/link";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { useAccount } from "@/providers/account-provider";

export function ProfileTab() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAccount();

  if (!user) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          {t("settings.profileTab")}
        </h2>
        <p className="text-xs text-[var(--muted)]">
          Kamu belum masuk. Masuk untuk melihat dan mengelola profil akun kamu.
        </p>
        <Link
          href="/login"
          className="inline-block px-4 py-2 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-sm font-semibold text-[var(--accent-text)] transition-colors"
        >
          {t("nav.login")}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          {t("settings.profileTab")}
        </h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">
          Informasi profil dan akun Devnuby kamu.
        </p>
      </div>

      <div className="flex items-center gap-3.5 sm:gap-4 p-3.5 rounded-[10px] border border-[var(--border)] bg-[var(--panel-elevated)]">
        <span className="grid place-items-center w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold text-base sm:text-lg shrink-0">
          {user.initials}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm sm:text-base text-[var(--ink)] truncate">{user.name}</p>
          <p className="text-xs sm:text-sm text-[var(--muted)] truncate">{user.email}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        <Field label="Name" value={user.name} />
        <Field label="Email" value={user.email} />
        <Field label="Plan" value={user.planLabel} />
        <Field label="Role" value={user.role ?? "user"} />
      </div>

      <div className="pt-2">
        <button
          type="button"
          onClick={() => toast(t("settings.saved"))}
          className="w-full sm:w-auto px-4 py-2.5 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-sm font-semibold text-[var(--accent-text)] transition-colors cursor-pointer text-center"
        >
          {t("settings.saveChanges")}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1 min-w-0">
      <label className="text-xs font-semibold text-[var(--muted)]">{label}</label>
      <div
        className="px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--panel-elevated)] text-sm text-[var(--ink)] truncate"
        title={value}
      >
        {value}
      </div>
    </div>
  );
}
