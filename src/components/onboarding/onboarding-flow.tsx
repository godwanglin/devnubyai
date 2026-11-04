"use client";

import React, { useEffect, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { DevnubyIcon } from "@/components/brand/devnuby-logo";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  BookOpenCheck,
  Boxes,
  Briefcase,
  Bug,
  CalendarCheck,
  ChartPie,
  Check,
  ClipboardCheck,
  ClipboardList,
  Code2,
  Coffee,
  Compass,
  Database,
  FileSearch,
  FileText,
  FlaskConical,
  GitPullRequest,
  GraduationCap,
  Handshake,
  Image as ImageIcon,
  Languages,
  Layers,
  LayoutTemplate,
  Lightbulb,
  ListChecks,
  Loader2,
  Mail,
  Megaphone,
  MessageSquareQuote,
  NotebookPen,
  Palette,
  PenLine,
  PiggyBank,
  Presentation,
  ScrollText,
  School,
  Search,
  Server,
  Share2,
  Sigma,
  Target,
  TestTube2,
  TrendingUp,
  Type,
  UserRound,
  Video,
  Wand2,
  type LucideIcon,
} from "lucide-react";
import { useI18n } from "@/providers/i18n-provider";
import { useToast } from "@/providers/toast-provider";
import { useAccount } from "@/providers/account-provider";
import { markHomeSuggestionsStale } from "@/hooks/use-home-suggestions";
import { cn } from "@/lib/cn";
import {
  MAX_INTERESTS,
  ONBOARDING_ROLES,
  ROLE_INTERESTS,
  ONBOARDING_STEPS,
  type OnboardingInterest,
  type OnboardingRole,
  type OnboardingStep,
} from "@/lib/onboarding/options";

const ROLE_ICONS: Record<OnboardingRole, LucideIcon> = {
  developer: Code2,
  student: GraduationCap,
  teacher: School,
  designer: Palette,
  writer: PenLine,
  business: Briefcase,
  researcher: FlaskConical,
  explorer: Compass,
};

const INTEREST_ICONS: Record<OnboardingInterest, LucideIcon> = {
  coding: Code2,
  debugging: Bug,
  code_review: GitPullRequest,
  learn_framework: Layers,
  architecture: Boxes,
  database: Database,
  devops: Server,
  testing: TestTube2,
  tech_docs: ScrollText,
  learning: BookOpen,
  homework: ClipboardList,
  summarize: ListChecks,
  exam_prep: BookOpenCheck,
  essay: PenLine,
  math: Sigma,
  thesis: GraduationCap,
  lesson_material: Presentation,
  quiz: ClipboardCheck,
  lesson_plan: CalendarCheck,
  grading: ClipboardCheck,
  explain_simply: Lightbulb,
  design_ideas: Wand2,
  ui_ux: LayoutTemplate,
  images: ImageIcon,
  branding: Palette,
  design_copy: Type,
  design_feedback: MessageSquareQuote,
  writing: PenLine,
  brainstorming: Lightbulb,
  social_content: Share2,
  storytelling: NotebookPen,
  video_script: Video,
  seo: Search,
  translation: Languages,
  strategy: Target,
  email_proposal: Mail,
  marketing: Megaphone,
  sales: Handshake,
  finance: PiggyBank,
  meeting_notes: NotebookPen,
  documents: FileText,
  research: FlaskConical,
  data: BarChart3,
  statistics: ChartPie,
  paper_summary: FileSearch,
  literature_review: BookOpen,
  report: TrendingUp,
  productivity: CalendarCheck,
  career: UserRound,
  daily_life: Coffee,
};

// Confetti pieces for the finish screen: evenly spread angles, fixed so renders match
const CONFETTI_COLORS = ["#38BDF8", "#818CF8", "#E879F9", "#F472B6", "#FBBF24", "#34D399"];
const CONFETTI = Array.from({ length: 22 }, (_, i) => {
  const angle = (i / 22) * Math.PI * 2;
  const distance = 90 + ((i * 37) % 60);
  return {
    x: Math.round(Math.cos(angle) * distance),
    y: Math.round(Math.sin(angle) * distance * 0.8 - 20),
    r: ((i * 73) % 360) - 180,
    d: (i % 5) * 40,
    w: i % 3 === 0 ? 6 : 8,
    h: i % 3 === 0 ? 6 : 4,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
  };
});

const STEP_PREFIX = "#/onboarding/";
const DRAFT_KEY = "devnuby-onboarding-draft";

interface Draft {
  name?: string;
  role?: OnboardingRole | null;
  interests?: OnboardingInterest[];
}

function readDraft(): Draft {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "{}") as Draft;
  } catch {
    return {};
  }
}

export function stepFromHash(hash: string): OnboardingStep | null {
  if (!hash.startsWith(STEP_PREFIX)) return null;
  const step = hash.slice(STEP_PREFIX.length) as OnboardingStep;
  return ONBOARDING_STEPS.includes(step) ? step : "name";
}

function setStepHash(step: OnboardingStep | null) {
  const base = window.location.pathname + window.location.search;
  window.history.replaceState(null, "", step ? `${base}${STEP_PREFIX}${step}` : base);
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

/**
 * Full-screen first-run flow at `#/onboarding/<step>`: name → role → interests → done.
 * Answers are saved in one request at the end; until then they sit in sessionStorage,
 * so a refresh mid-way keeps both the step (from the URL) and the answers.
 */
export function OnboardingFlow({ step, onFinished }: { step: OnboardingStep; onFinished: () => void }) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { user, refresh } = useAccount();

  const [name, setName] = useState(() => readDraft().name ?? user?.name ?? "");
  const [role, setRole] = useState<OnboardingRole | null>(() => readDraft().role ?? null);
  const [interests, setInterests] = useState<OnboardingInterest[]>(() => readDraft().interests ?? []);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ name, role, interests } satisfies Draft));
  }, [name, role, interests]);

  // A later step opened directly (or after a lost draft) goes back to the first unanswered one
  useEffect(() => {
    if (step === "role" && !name.trim()) setStepHash("name");
    if (step === "interests" && !role) setStepHash(name.trim() ? "role" : "name");
  }, [step, name, role]);

  const index = ONBOARDING_STEPS.indexOf(step);

  // Slide direction: forward steps come in from the right, going back from the left
  const [motion, setMotion] = useState<{ step: OnboardingStep; index: number; dir: "next" | "back" }>({
    step,
    index,
    dir: "next",
  });
  if (motion.step !== step) {
    setMotion({ step, index, dir: index < motion.index ? "back" : "next" });
  }
  const total = ONBOARDING_STEPS.length - 1; // "done" isn't a question
  const firstName = name.trim().split(/\s+/)[0] || "";

  const go = (next: OnboardingStep) => setStepHash(next);
  const back = () => index > 0 && go(ONBOARDING_STEPS[index - 1]);

  // Step 3 offers the options of the chosen role, most relevant first
  const roleInterests = role ? ROLE_INTERESTS[role] : ROLE_INTERESTS.explorer;

  function chooseRole(next: OnboardingRole) {
    setRole(next);
    // Keep picks that the new role also offers; drop the rest
    setInterests((prev) => prev.filter((i) => ROLE_INTERESTS[next].includes(i)));
  }

  function toggleInterest(id: OnboardingInterest) {
    if (interests.includes(id)) {
      setInterests(interests.filter((i) => i !== id));
      return;
    }
    // Checked outside the state updater: updaters run during render, where a toast can't be shown
    if (interests.length >= MAX_INTERESTS) {
      toast(t("onboarding.interestsMax", { max: MAX_INTERESTS }));
      return;
    }
    setInterests([...interests, id]);
  }

  async function save(skipped: boolean) {
    setSaving(true);
    try {
      const res = await fetch("/api/v1/me/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          skipped
            ? { skipped: true, locale, name: name.trim() || undefined }
            : { name: name.trim() || undefined, role, interests, locale }
        ),
      });
      if (!res.ok) throw new Error();
      // The server dropped the old suggestions and is building new ones; the home waits for them
      markHomeSuggestionsStale();
      await refresh();
      if (skipped) finish();
      else go("done");
    } catch {
      toast(t("onboarding.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function finish() {
    sessionStorage.removeItem(DRAFT_KEY);
    setStepHash(null);
    onFinished();
  }


  const primaryBtn =
    "inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-[12px] bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-sm font-semibold text-[var(--accent-text)] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
  const ghostBtn =
    "inline-flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-sm text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--hover)] transition-colors cursor-pointer";

  // Same popup as login (shared Modal: overlay, z-index, backdrop); closing it skips onboarding
  return (
    <Modal isOpen onClose={() => (step === "done" ? finish() : void save(true))} maxWidth="4xl">
      {/* Progress pinned near the top edge, centered; skip on the left (the close X is right) */}
      {step !== "done" && (
        <>
          <div
            className="absolute top-4 left-1/2 -translate-x-1/2 w-[220px] flex gap-1.5"
            aria-label={t("onboarding.progress", { step: index + 1, total })}
          >
            {Array.from({ length: total }).map((_, i) => (
              <span
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors duration-300",
                  i <= index ? "bg-[var(--accent)]" : "bg-[var(--border)]"
                )}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => void save(true)}
            disabled={saving}
            className={cn(ghostBtn, "absolute top-2.5 left-3 py-1")}
          >
            {t("onboarding.skip")}
          </button>
        </>
      )}

      <main className="flex items-center justify-center min-h-[520px] px-1 sm:px-10 py-8">
        <div
          key={step}
          className={cn(
            "w-full max-w-[680px] mx-auto",
            motion.dir === "back" ? "onboarding-step-back" : "onboarding-step-next"
          )}
        >
          {step === "name" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) go("role");
              }}
              className="space-y-8"
            >
              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--accent)]">{t("onboarding.nameEyebrow")}</p>
                <h1 className="text-2xl sm:text-3xl font-bold text-[var(--ink)] tracking-tight">{t("onboarding.nameTitle")}</h1>
                <p className="text-sm text-[var(--muted)]">{t("onboarding.nameSubtitle")}</p>
              </div>
              <input
                autoFocus
                value={name}
                maxLength={120}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("onboarding.namePlaceholder")}
                autoComplete="name"
                aria-label={t("onboarding.nameTitle")}
                className="w-full px-4 py-3.5 rounded-[14px] border border-[var(--border)] bg-[var(--panel)] text-lg text-[var(--ink)] placeholder:text-[var(--placeholder)] focus:border-[var(--accent)] outline-none"
              />
              <div className="flex justify-end">
                <button type="submit" disabled={!name.trim()} className={primaryBtn}>
                  {t("onboarding.next")}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </form>
          )}

          {step === "role" && (
            <div className="space-y-8">
              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--accent)]">
                  {firstName ? t("onboarding.roleEyebrow", { name: firstName }) : t("onboarding.roleEyebrowNoName")}
                </p>
                <h1 className="text-2xl sm:text-3xl font-bold text-[var(--ink)] tracking-tight">{t("onboarding.roleTitle")}</h1>
                <p className="text-sm text-[var(--muted)]">{t("onboarding.roleSubtitle")}</p>
              </div>
              <div
                className="onboarding-stagger grid grid-cols-2 sm:grid-cols-4 gap-2.5"
                role="radiogroup"
                aria-label={t("onboarding.roleTitle")}
              >
                {ONBOARDING_ROLES.map(({ id }, i) => {
                  const Icon = ROLE_ICONS[id];
                  const active = role === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => chooseRole(id)}
                      style={{ "--i": i } as React.CSSProperties}
                      className={cn(
                        "relative flex flex-col items-start gap-3 p-3.5 rounded-[14px] border text-left transition-all cursor-pointer",
                        active
                          ? "border-[var(--accent)] bg-[var(--accent-soft)] shadow-sm"
                          : "border-[var(--border)] bg-[var(--panel)] hover:border-[var(--muted)]/50 hover:-translate-y-0.5"
                      )}
                    >
                      <span
                        className={cn(
                          "grid place-items-center w-9 h-9 rounded-[10px]",
                          active ? "bg-[var(--accent)] text-[var(--accent-text)]" : "bg-[var(--hover)] text-[var(--ink)]"
                        )}
                      >
                        <Icon className="w-4.5 h-4.5" />
                      </span>
                      <span className="text-sm font-medium text-[var(--ink)] leading-snug">{t(`onboarding.roles.${id}`)}</span>
                      {active && <Check className="absolute top-3 right-3 w-4 h-4 text-[var(--accent)]" />}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between">
                <button type="button" onClick={back} className={ghostBtn}>
                  <ArrowLeft className="w-4 h-4" />
                  {t("onboarding.back")}
                </button>
                <button type="button" onClick={() => go("interests")} disabled={!role} className={primaryBtn}>
                  {t("onboarding.next")}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {step === "interests" && (
            <div className="space-y-8">
              <div className="space-y-2">
                <p className="text-sm font-medium text-[var(--accent)]">{t("onboarding.interestsEyebrow")}</p>
                <h1 className="text-2xl sm:text-3xl font-bold text-[var(--ink)] tracking-tight">{t("onboarding.interestsTitle")}</h1>
                <p className="text-sm text-[var(--muted)]">{t("onboarding.interestsSubtitle", { max: MAX_INTERESTS })}</p>
              </div>
              <div className="onboarding-stagger flex flex-wrap gap-2">
                {roleInterests.map((id, i) => {
                  const Icon = INTEREST_ICONS[id];
                  const active = interests.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleInterest(id)}
                      style={{ "--i": i } as React.CSSProperties}
                      className={cn(
                        "inline-flex items-center gap-2 px-3.5 py-2 rounded-full border text-sm transition-all cursor-pointer",
                        active
                          ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--ink)] font-medium"
                          : "border-[var(--border)] bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--ink)] hover:border-[var(--muted)]/50"
                      )}
                    >
                      {active ? <Check className="w-4 h-4 text-[var(--accent)]" /> : <Icon className="w-4 h-4" />}
                      {t(`onboarding.interests.${id}`)}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between">
                <button type="button" onClick={back} className={ghostBtn}>
                  <ArrowLeft className="w-4 h-4" />
                  {t("onboarding.back")}
                </button>
                <button
                  type="button"
                  onClick={() => void save(false)}
                  disabled={interests.length === 0 || saving}
                  className={primaryBtn}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {t("onboarding.finish")}
                  {!saving && <ArrowRight className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {step === "done" && (
            <div className="flex flex-col items-center text-center space-y-6">
              {/* Happy mascot hopping, with a one-time confetti burst behind it */}
              <div className="onboarding-pop relative w-40 h-40 flex items-end justify-center" aria-hidden="true">
                {CONFETTI.map((c, i) => (
                  <span
                    key={i}
                    className="onboarding-confetti absolute left-1/2 top-1/2 rounded-[2px]"
                    style={
                      {
                        width: c.w,
                        height: c.h,
                        background: c.color,
                        "--x": `${c.x}px`,
                        "--y": `${c.y}px`,
                        "--r": `${c.r}deg`,
                        "--d": `${c.d}ms`,
                      } as React.CSSProperties
                    }
                  />
                ))}
                <span className="onboarding-hop-shadow absolute bottom-1 w-16 h-2.5 rounded-full bg-black/60 blur-[2px]" />
                <div className="onboarding-hop relative mb-2.5">
                  <DevnubyIcon bare mood="happy-chevrons" autoCycle={false} interactive={false} className="w-24 h-24" />
                </div>
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl sm:text-3xl font-bold text-[var(--ink)] tracking-tight">
                  {firstName ? t("onboarding.doneTitle", { name: firstName }) : t("onboarding.doneTitleNoName")}
                </h1>
                <p className="text-sm text-[var(--muted)] max-w-[400px]">{t("onboarding.doneSubtitle")}</p>
              </div>
              <button type="button" onClick={finish} autoFocus className={primaryBtn}>
                {t("onboarding.start")}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </main>
    </Modal>
  );
}
