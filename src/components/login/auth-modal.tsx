"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { DevnubyIcon } from "@/components/brand/devnuby-logo";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { cn } from "@/lib/cn";

type Step = "email" | "login" | "register";

const EMAIL_KEY = "devnuby-auth-email";
const stepFromHash = (): Step => {
  if (typeof window === "undefined") return "email";
  if (window.location.hash === "#/authenticate/login") return "login";
  if (window.location.hash === "#/authenticate/create-account") return "register";
  return "email";
};

function safeNextPath(): string {
  if (typeof window === "undefined") return "/";
  const next = new URLSearchParams(window.location.search).get("next");
  if (next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") && !next.startsWith("/register")) {
    return next;
  }
  return "/";
}

function GoogleMark() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z" />
      <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.04 0 12s.45 3.82 1.25 5.42l4.03-3.15z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" />
    </svg>
  );
}

function strengthOf(password: string): number {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(4, score);
}

const STRENGTH_COLOR = ["bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-emerald-500"];

export function AuthModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  // The email of a step past the first is kept in sessionStorage, so a refresh lands back
  // on it; without one (new tab, cleared storage) the flow starts from the email step
  const [email, setEmail] = useState(() =>
    typeof window === "undefined" ? "" : sessionStorage.getItem(EMAIL_KEY) ?? ""
  );
  const [step, setStep] = useState<Step>(() => (email ? stepFromHash() : "email"));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const strength = useMemo(() => strengthOf(password), [password]);
  const rules = [
    { ok: password.length >= 8, label: t("auth.ruleLength") },
    { ok: /[a-z]/.test(password) && /[A-Z]/.test(password), label: t("auth.ruleCase") },
    { ok: /\d/.test(password), label: t("auth.ruleNumber") },
  ];

  function goTo(next: Step) {
    const hash = next === "login" ? "#/authenticate/login" : next === "register" ? "#/authenticate/create-account" : "#/authenticate";
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hash}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    setStep(next);
  }

  function reset() {
    sessionStorage.removeItem(EMAIL_KEY);
    setEmail("");
    setPassword("");
    setConfirm("");
    setLoading(false);
    goTo("email");
  }

  function handleClose() {
    reset();
    if (window.location.hash === "#/authenticate") {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    onClose();
  }

  function continueWithGoogle() {
    const next = safeNextPath();
    if (next !== "/") {
      document.cookie = `devnuby_login_next=${encodeURIComponent(next)}; path=/; max-age=600; samesite=lax`;
    }
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = "/api/v1/auth/google";
  }

  async function checkEmail(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/v1/auth/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error?.message || t("auth.failed"));
      sessionStorage.setItem(EMAIL_KEY, email.trim());
      goTo(data.data?.exists ? "login" : "register");
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : t("auth.failed"));
    } finally {
      setLoading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (step === "register" && password !== confirm) {
      toast(t("auth.mismatch"));
      return;
    }
    setLoading(true);
    try {
      const endpoint = step === "login" ? "/api/v1/auth/login" : "/api/v1/auth/register";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error?.message || t("auth.failed"));
      toast(step === "login" ? t("auth.loginSuccess") : t("auth.registerSuccess"));
      sessionStorage.removeItem(EMAIL_KEY);
      // A full page load (the target never carries a #hash, which would only change the
      // fragment and keep the signed-out state). After it, the chat shell sees a user who
      // hasn't onboarded yet and opens #/onboarding itself.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(safeNextPath());
    } catch (err: unknown) {
      toast(err instanceof Error ? err.message : t("auth.failed"));
      setLoading(false);
    }
  }

  const field =
    "w-full px-3 py-2.5 rounded-[10px] border border-[var(--border)] bg-transparent text-sm text-[var(--ink)] placeholder:text-[var(--placeholder)] focus:border-[var(--accent)] outline-none";

  return (
    <Modal isOpen={isOpen} onClose={handleClose} maxWidth="sm">
      <div className="flex flex-col items-center text-center">
        <DevnubyIcon className="w-10 h-10 mb-3" />
        <h2 className="text-lg font-semibold text-[var(--ink)]">
          {step === "register" ? t("auth.registerTitle") : t("auth.title")}
        </h2>
        <p className="text-xs text-[var(--muted)] mt-1 mb-5">{t("auth.subtitle")}</p>
      </div>

      {step === "email" && (
        <>
          <button
            type="button"
            onClick={continueWithGoogle}
            className="flex items-center justify-center gap-3 w-full py-2.5 px-4 rounded-[10px] border border-[var(--border)] bg-[var(--panel-elevated)] hover:bg-[var(--hover)] text-sm font-semibold text-[var(--ink)] transition-colors cursor-pointer"
          >
            <GoogleMark />
            {t("auth.google")}
          </button>
          <div className="flex items-center gap-3 my-4">
            <div className="flex-1 h-px bg-[var(--border)]" />
            <span className="text-[11px] uppercase tracking-wider text-[var(--placeholder)]">{t("auth.or")}</span>
            <div className="flex-1 h-px bg-[var(--border)]" />
          </div>
          <form onSubmit={checkEmail} className="space-y-3">
            <div className="space-y-1 text-left">
              <label className="text-xs font-semibold text-[var(--ink)]">{t("auth.emailLabel")}</label>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("auth.emailPlaceholder")}
                autoComplete="email"
                className={field}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-sm font-semibold text-[var(--accent-text)] transition-colors cursor-pointer disabled:opacity-50"
            >
              {loading ? "..." : t("auth.continue")}
            </button>
          </form>
        </>
      )}

      {step !== "email" && (
        <form onSubmit={submit} className="space-y-3">
          <div className="flex items-center justify-between rounded-[10px] border border-[var(--border)] px-3 py-2">
            <div className="min-w-0 text-left">
              <p className="text-[11px] text-[var(--placeholder)]">{t("auth.emailLabel")}</p>
              <p className="text-sm text-[var(--ink)] truncate">{email}</p>
            </div>
            <button type="button" onClick={reset} className="text-xs font-semibold text-[var(--accent)] hover:underline cursor-pointer shrink-0">
              {t("auth.edit")}
            </button>
          </div>

          <input
            type="password"
            required
            autoFocus
            minLength={step === "register" ? 8 : 1}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("auth.passwordPlaceholder")}
            autoComplete={step === "login" ? "current-password" : "new-password"}
            className={field}
          />

          {step === "register" && (
            <>
              <div className="flex gap-1" aria-hidden="true">
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className={cn("h-1 flex-1 rounded-full bg-[var(--border)]", password && i < strength && STRENGTH_COLOR[strength - 1])}
                  />
                ))}
              </div>
              <ul className="space-y-1">
                {rules.map((rule) => (
                  <li key={rule.label} className={cn("flex items-center gap-1.5 text-[11px]", rule.ok ? "text-emerald-500" : "text-[var(--placeholder)]")}>
                    {rule.ok ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                    {rule.label}
                  </li>
                ))}
              </ul>
              <input
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t("auth.confirmPlaceholder")}
                autoComplete="new-password"
                className={field}
              />
            </>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-[10px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-sm font-semibold text-[var(--accent-text)] transition-colors cursor-pointer disabled:opacity-50"
          >
            {loading ? "..." : step === "login" ? t("auth.login") : t("auth.register")}
          </button>
        </form>
      )}

      <p className="text-[11px] text-[var(--placeholder)] text-center leading-relaxed mt-4">
        {t("auth.termsLead")}{" "}
        <Link href="/terms" className="underline hover:text-[var(--ink)]">{t("auth.termsLink")}</Link>
        {" "}{t("auth.termsAnd")}{" "}
        <Link href="/privacy" className="underline hover:text-[var(--ink)]">{t("auth.privacyLink")}</Link>
        {t("auth.termsTail")}
      </p>
    </Modal>
  );
}
