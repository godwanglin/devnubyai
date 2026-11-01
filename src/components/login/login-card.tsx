"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DevnubyIcon } from "@/components/brand/devnuby-logo";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";

export function LoginCard() {
  const { t } = useI18n();
  const { toast } = useToast();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // Surface OAuth callback failures (?error=...) once after mount
  useEffect(() => {
    const error = new URLSearchParams(window.location.search).get("error");
    if (error) {
      toast(error === "access_denied" ? "Login Google dibatalkan" : "Login gagal, silakan coba lagi");
      router.replace("/login");
    }
  }, [toast, router]);

  function handleGoogleLogin() {
    setLoading(true);
    // Full navigation: the server sets state/PKCE cookies and redirects to Google
    // (a route handler, not a page, so client-side router.push does not apply)
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/api/v1/auth/google";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      toast(t("login.fillAllFields") || "Harap isi email dan kata sandi");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error?.message || t("login.loginFailed") || "Email atau kata sandi salah");
      }
      toast(t("login.loginSuccess") || "Login berhasil!");
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = "/";
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t("login.loginFailed") || "Login gagal";
      toast(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-4 bg-[var(--surface)]">
      <div className="w-full max-w-[400px] glass rounded-[16px] p-6 sm:p-7 shadow-2xl border border-[var(--glass-border)] bg-[var(--panel)]">
        <div className="flex items-center justify-between mb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>{t("login.backToChat")}</span>
          </Link>
          <DevnubyIcon className="w-9 h-9" />
        </div>

        <div className="space-y-1 mb-6">
          <h1 className="text-xl font-bold text-[var(--ink)] tracking-tight">
            {t("login.title")}
          </h1>
          <p className="text-xs text-[var(--muted)]">{t("login.subtitle")}</p>
        </div>

        {/* Google OAuth Option */}
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={loading}
          className="flex items-center justify-center gap-3 w-full py-2.5 px-4 rounded-[10px] border border-[var(--border)] bg-[var(--panel-elevated)] hover:bg-[var(--hover)] text-sm font-semibold text-[var(--ink)] transition-colors cursor-pointer disabled:opacity-50"
        >
          {/* SVG Google Official Minimal */}
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
            />
            <path
              fill="#34A853"
              d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
            />
            <path
              fill="#FBBC05"
              d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.04 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
            />
            <path
              fill="#EA4335"
              d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
            />
          </svg>
          <span>{t("login.google")}</span>
        </button>

        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-[var(--border)]" />
          <span className="text-[11px] uppercase tracking-wider text-[var(--placeholder)] font-medium">
            {t("login.or")}
          </span>
          <div className="flex-1 h-px bg-[var(--border)]" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-[var(--ink)]">
              {t("login.emailLabel")}
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("login.emailPlaceholder")}
              className="w-full px-3 py-2 rounded-[10px] border border-[var(--border)] bg-transparent text-sm text-[var(--ink)] placeholder:text-[var(--placeholder)] focus:border-[var(--accent)]"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-[var(--ink)]">
              {t("login.passwordLabel")}
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-3 py-2 rounded-[10px] border border-[var(--border)] bg-transparent text-sm text-[var(--ink)] placeholder:text-[var(--placeholder)] focus:border-[var(--accent)]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-sm font-semibold text-[var(--accent-text)] transition-colors cursor-pointer disabled:opacity-50"
          >
            {loading ? "..." : t("login.submit")}
          </button>
        </form>

        <p className="text-[11px] text-[var(--placeholder)] text-center leading-relaxed mt-5">
          {t("login.terms")}
        </p>
      </div>
    </div>
  );
}
