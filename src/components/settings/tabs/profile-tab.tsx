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
          Kamu belum masuk. Masuk dengan akun Google untuk melihat profil dan kuota.
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

  const limitTokens = user.quota.limitTokens;
  const quotaDisplay =
    limitTokens == null
      ? "Unlimited (∞)"
      : `${user.quota.usedPercent}% (${(user.quota.usedTokens ?? 0).toLocaleString()} / ${limitTokens.toLocaleString()} tokens)`;

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold text-[var(--ink)]">
        {t("settings.profileTab")}
      </h2>

      <div className="flex items-center gap-4">
        <span className="grid place-items-center w-14 h-14 rounded-full bg-[var(--accent)] text-[var(--accent-text)] font-bold text-base">
          {user.initials}
        </span>
        <div>
          <p className="font-semibold text-[var(--ink)]">{user.name}</p>
          <p className="text-sm text-[var(--muted)]">{user.email}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Name" value={user.name} />
        <Field label="Email" value={user.email} />
        <Field label="Plan" value={user.planLabel} />
        <Field label="Role" value={user.role ?? "user"} />
        <div className="col-span-2">
          <Field label={t("nav.monthlyQuota")} value={quotaDisplay} />
        </div>
      </div>

      <button
        type="button"
        onClick={() => toast(t("settings.saved"))}
        className="px-4 py-2 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-sm font-semibold text-[var(--accent-text)] transition-colors cursor-pointer"
      >
        {t("settings.saveChanges")}
      </button>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-[var(--muted)]">{label}</label>
      <div className="px-3 py-2 rounded-[8px] border border-[var(--border)] bg-[var(--panel-elevated)] text-sm text-[var(--ink)]">
        {value}
      </div>
    </div>
  );
}

