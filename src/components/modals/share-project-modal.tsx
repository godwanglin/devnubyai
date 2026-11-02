"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Globe,
  Lock,
  Check,
  Link2,
  Info,
  X,
  Mail,
  Loader2,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Popover } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { useI18n } from "@/providers/i18n-provider";
import { useAccount } from "@/providers/account-provider";
import { useToast } from "@/providers/toast-provider";
import type { ProjectDto } from "@/lib/projects/types";

interface InviteLookupUser {
  name: string;
  email: string;
  avatarUrl: string | null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LOOKUP_DEBOUNCE_MS = 300;

function initialsOf(name: string): string {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "U"
  );
}

export interface ShareProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectDto;
  onProjectUpdated?: (updated: ProjectDto) => void;
}

export function ShareProjectModal({
  isOpen,
  onClose,
  project,
  onProjectUpdated,
}: ShareProjectModalProps) {
  const { t } = useI18n();
  const { user } = useAccount();
  const { toast } = useToast();

  const [emailInput, setEmailInput] = useState("");
  const [access, setAccess] = useState<"anyone" | "invited">(
    project.shareAccess || "invited"
  );
  const [invitedList, setInvitedList] = useState<string[]>(
    project.invitedEmails || []
  );
  const [accessDropdownOpen, setAccessDropdownOpen] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);

  // The email being typed (last comma-separated token), once it is complete and new
  const inviteCandidate = useMemo(() => {
    const last = emailInput.split(/[,;\s]+/).pop()?.trim().toLowerCase() ?? "";
    return EMAIL_PATTERN.test(last) && !invitedList.includes(last) ? last : null;
  }, [emailInput, invitedList]);

  const lookupCache = useRef(new Map<string, InviteLookupUser | null>());
  const [lookup, setLookup] = useState<{ email: string; user: InviteLookupUser | null } | null>(
    null
  );

  /** Registered user for an email, or null when there is none (or the lookup failed). */
  const lookupEmail = useCallback(async (email: string): Promise<InviteLookupUser | null> => {
    const cached = lookupCache.current.get(email);
    if (cached !== undefined) return cached;
    try {
      const res = await fetch(`/api/v1/users/lookup?email=${encodeURIComponent(email)}`, {
        credentials: "same-origin",
      });
      if (!res.ok) return null;
      const json = await res.json();
      const found = (json?.data?.user as InviteLookupUser | null) ?? null;
      // Only real answers are cached; a rate-limit or network error retries later
      lookupCache.current.set(email, found);
      return found;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!inviteCandidate) return;
    const timer = setTimeout(
      async () => {
        const found = await lookupEmail(inviteCandidate);
        setLookup({ email: inviteCandidate, user: found });
      },
      lookupCache.current.has(inviteCandidate) ? 0 : LOOKUP_DEBOUNCE_MS
    );
    return () => clearTimeout(timer);
  }, [inviteCandidate, lookupEmail]);

  // Ignore answers for an email the user has since changed
  const resolvedLookup = lookup && lookup.email === inviteCandidate ? lookup : null;
  const showInviteSuggestion = inputFocused && inviteCandidate !== null;
  const ownEmail = user?.email?.toLowerCase() ?? "";
  const candidateIsSelf = inviteCandidate !== null && inviteCandidate === ownEmail;
  // Only a registered user other than yourself can be added from the suggestion
  const canAddCandidate = !candidateIsSelf && Boolean(resolvedLookup?.user);

  // The suggestion is portaled to <body>: nested inside the modal's own
  // backdrop-filter, `.glass` would not blur what is behind it.
  const inviteFormRef = useRef<HTMLFormElement>(null);
  const [suggestionCoords, setSuggestionCoords] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!showInviteSuggestion) return;
    const update = () => {
      const rect = inviteFormRef.current?.getBoundingClientRect();
      if (rect) setSuggestionCoords({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [showInviteSuggestion]);
  const [copied, setCopied] = useState(false);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shareUrl = project.shareToken
    ? `${origin}/project/share/${project.shareToken}`
    : `${origin}/project/${project.id}`;

  const userInitials =
    user?.name
      ?.split(" ")
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "DP";

  async function handleSaveShare(
    nextAccess = access,
    nextEmails = invitedList
  ) {
    try {
      const res = await fetch(`/api/v1/projects/${project.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shareAccess: nextAccess,
          invitedEmails: nextEmails,
        }),
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Failed to update share settings");
      const json = await res.json();
      // The server drops self / unregistered emails: mirror what was actually saved
      if (Array.isArray(json.data?.invitedEmails)) {
        setInvitedList(json.data.invitedEmails);
      }
      if (json.data && onProjectUpdated) {
        onProjectUpdated({
          ...project,
          shareToken: json.data.shareToken,
          shareAccess: json.data.shareAccess,
          invitedEmails: json.data.invitedEmails,
        });
      }
    } catch {
      toast(t("toast.actionFailed"));
    }
  }

  /** Only registered users can be invited; unknown emails stay in the input. */
  async function handleAddEmails(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const raw = emailInput.trim();
    if (!raw) return;

    const parsed = [
      ...new Set(
        raw
          .split(/[,;\s]+/)
          .map((x) => x.trim().toLowerCase())
          .filter((x) => EMAIL_PATTERN.test(x) && !invitedList.includes(x))
      ),
    ];
    // You own the project already: never add yourself as a collaborator
    if (ownEmail && parsed.includes(ownEmail)) {
      toast(t("projects.inviteSelf"));
    }
    const emails = parsed.filter((x) => x !== ownEmail);
    if (emails.length === 0) {
      setEmailInput("");
      return;
    }

    const users = await Promise.all(emails.map(lookupEmail));
    const registered = emails.filter((_, i) => users[i]);
    const unregistered = emails.filter((_, i) => !users[i]);

    setEmailInput(unregistered.join(", "));
    if (unregistered.length > 0) {
      toast(t("projects.inviteOnlyRegistered", { emails: unregistered.join(", ") }));
    }
    if (registered.length > 0) {
      const updated = [...invitedList, ...registered];
      setInvitedList(updated);
      void handleSaveShare(access, updated);
    }
  }

  function handleRemoveEmail(emailToRemove: string) {
    const updated = invitedList.filter((e) => e !== emailToRemove);
    setInvitedList(updated);
    void handleSaveShare(access, updated);
  }

  function handleChangeAccess(newAccess: "anyone" | "invited") {
    setAccess(newAccess);
    setAccessDropdownOpen(false);
    void handleSaveShare(newAccess, invitedList);
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast(t("projects.linkCopied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast(t("toast.actionFailed"));
    }
  }

  function openSocialShare(platform: "x" | "reddit" | "linkedin") {
    const text = encodeURIComponent(`Proyek DevNuby AI: ${project.name}`);
    const u = encodeURIComponent(shareUrl);
    let url = "";

    if (platform === "x") {
      url = `https://twitter.com/intent/tweet?url=${u}&text=${text}`;
    } else if (platform === "reddit") {
      url = `https://www.reddit.com/submit?url=${u}&title=${text}`;
    } else if (platform === "linkedin") {
      url = `https://www.linkedin.com/sharing/share-offsite/?url=${u}`;
    }

    if (url && typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer,width=600,height=500");
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`${t("projects.shareProject")} ${project.name}`}
      maxWidth="md"
    >
      <div className="space-y-4 pt-1">
        {/* Email invite input */}
        <form ref={inviteFormRef} onSubmit={handleAddEmails} className="relative flex items-center">
          <Input
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void handleAddEmails();
              }
            }}
            placeholder={t("projects.emailInvitePlaceholder")}
            className="text-xs"
          />

          {/* Suggestion for the completed email: registered users show their name */}
          {showInviteSuggestion && suggestionCoords ? createPortal(
            <div
              style={{
                top: suggestionCoords.top,
                left: suggestionCoords.left,
                width: suggestionCoords.width,
              }}
              // Above the modal (9999), same layer as popovers
              className="popover-panel fixed z-[10060] p-1.5 rounded-[12px] glass shadow-xl"
            >
              <button
                type="button"
                // Keep focus in the input so the click doesn't close the suggestion first
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void handleAddEmails()}
                // Unregistered emails and your own email are shown but can't be added
                disabled={!canAddCandidate}
                className={cn(
                  "flex items-center gap-2.5 w-full px-2 py-1.5 rounded-[8px] text-left",
                  canAddCandidate ? "glass-hover cursor-pointer" : "cursor-not-allowed"
                )}
              >
                {!resolvedLookup ? (
                  <span className="grid place-items-center w-7 h-7 shrink-0 rounded-full bg-[var(--hover)] text-[var(--muted)]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  </span>
                ) : resolvedLookup.user?.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={resolvedLookup.user.avatarUrl}
                    alt=""
                    className="w-7 h-7 shrink-0 rounded-full object-cover"
                  />
                ) : resolvedLookup.user ? (
                  <span className="grid place-items-center w-7 h-7 shrink-0 rounded-full bg-[var(--accent)] text-[var(--accent-text)] text-[10px] font-bold">
                    {initialsOf(resolvedLookup.user.name)}
                  </span>
                ) : (
                  <span className="grid place-items-center w-7 h-7 shrink-0 rounded-full bg-[var(--hover)] text-[var(--muted)]">
                    <Mail className="w-3.5 h-3.5" />
                  </span>
                )}
                <span className="flex flex-col min-w-0">
                  {resolvedLookup?.user ? (
                    <>
                      <span className="text-xs font-medium text-[var(--ink)] truncate">
                        {resolvedLookup.user.name}
                      </span>
                      <span className="text-[11px] text-[var(--muted)] truncate">
                        {candidateIsSelf ? t("projects.inviteSelfLabel") : resolvedLookup.user.email}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-xs font-medium text-[var(--ink)] truncate">
                        {inviteCandidate}
                      </span>
                      {resolvedLookup ? (
                        <span className="text-[11px] text-[var(--muted)] truncate">
                          {t("projects.inviteNotRegistered")}
                        </span>
                      ) : null}
                    </>
                  )}
                </span>
              </button>
            </div>,
            document.body
          ) : null}
        </form>

        {/* Access dropdown row */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-[var(--muted)]">
            {t("projects.whoHasAccess")}
          </div>

          <Popover
            isOpen={accessDropdownOpen}
            onOpenChange={setAccessDropdownOpen}
            side="bottom"
            align="start"
            className="w-[240px]"
            trigger={
              <button
                type="button"
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-[8px] hover:bg-[var(--hover)] text-xs font-medium text-[var(--ink)] transition-colors cursor-pointer select-none"
              >
                {access === "anyone" ? (
                  <Globe className="w-4 h-4 text-[var(--muted)]" />
                ) : (
                  <Lock className="w-4 h-4 text-[var(--muted)]" />
                )}
                <span>
                  {access === "anyone"
                    ? t("projects.accessAnyone")
                    : t("projects.accessInvited")}
                </span>
                <span className="text-[10px] text-[var(--placeholder)]">▾</span>
              </button>
            }
          >
            <div className="space-y-0.5 text-xs">
              <button
                type="button"
                onClick={() => handleChangeAccess("invited")}
                className="glass-hover flex items-center justify-between w-full px-2.5 py-2 rounded-[6px] text-xs text-left text-[var(--ink)] cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-[var(--muted)]" />
                  <span>{t("projects.accessInvited")}</span>
                </div>
                {access === "invited" && <Check className="w-3.5 h-3.5 text-[var(--ink)]" />}
              </button>

              <button
                type="button"
                onClick={() => handleChangeAccess("anyone")}
                className="glass-hover flex items-center justify-between w-full px-2.5 py-2 rounded-[6px] text-xs text-left text-[var(--ink)] cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-[var(--muted)]" />
                  <span>{t("projects.accessAnyone")}</span>
                </div>
                {access === "anyone" && <Check className="w-3.5 h-3.5 text-[var(--ink)]" />}
              </button>
            </div>
          </Popover>
        </div>

        {/* Members / Collaborators list */}
        <div className="space-y-2 pt-1 max-h-40 overflow-y-auto">
          {/* Owner row */}
          <div className="flex items-center justify-between py-1.5 px-2 rounded-[8px] hover:bg-[var(--hover)]/40 transition-colors">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="grid place-items-center w-7 h-7 rounded-full bg-[var(--accent)] text-[11px] font-bold text-[var(--accent-text)] shrink-0">
                {userInitials}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[var(--ink)] truncate">
                  {user?.name || "Denis Prasetio"}
                </p>
                <p className="text-[11px] text-[var(--placeholder)] truncate">
                  {user?.email}
                </p>
              </div>
            </div>
            <span className="text-xs text-[var(--placeholder)] font-medium shrink-0">
              {t("projects.ownerRole")}
            </span>
          </div>

          {/* Invited emails */}
          {invitedList.map((email) => (
            <div
              key={email}
              className="flex items-center justify-between py-1 px-2 rounded-[8px] hover:bg-[var(--hover)]/40 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="grid place-items-center w-7 h-7 rounded-full bg-[var(--panel-elevated)] border border-[var(--border)] text-[11px] font-semibold text-[var(--muted)] shrink-0">
                  {email[0].toUpperCase()}
                </div>
                <p className="text-xs text-[var(--ink)] truncate">{email}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] text-[var(--placeholder)]">
                  {t("projects.collaboratorRole")}
                </span>
                <button
                  type="button"
                  onClick={() => handleRemoveEmail(email)}
                  className="grid place-items-center w-5 h-5 rounded hover:bg-[var(--hover)] text-[var(--placeholder)] hover:text-[var(--danger)] transition-colors cursor-pointer"
                  aria-label="Remove"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Info callout box (Gambar 2) */}
        <div className="flex items-start gap-2.5 p-3 rounded-[10px] bg-[var(--panel-elevated)] border border-[var(--border)] text-xs text-[var(--muted)] leading-relaxed">
          <Info className="w-4 h-4 shrink-0 text-[var(--placeholder)] mt-0.5" />
          <p className="flex-1">{t("projects.shareInfoCallout")}</p>
        </div>

        {/* Footer: Social share icons + Copy link button */}
        <div className="flex items-center justify-between pt-2">
          {/* Social icons */}
          <div className="flex items-center gap-1 text-[var(--muted)]">
            {/* LinkedIn */}
            <button
              type="button"
              onClick={() => openSocialShare("linkedin")}
              className="grid place-items-center w-8 h-8 rounded-[8px] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
              aria-label="Share on LinkedIn"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z" />
              </svg>
            </button>

            {/* Reddit */}
            <button
              type="button"
              onClick={() => openSocialShare("reddit")}
              className="grid place-items-center w-8 h-8 rounded-[8px] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
              aria-label="Share on Reddit"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M12 2A10 10 0 0 0 2 12a10 10 0 0 0 10 10 10 10 0 0 0 10-10A10 10 0 0 0 12 2zm5.01 4.75c.69 0 1.25.56 1.25 1.25a1.25 1.25 0 0 1-2.22.81c-1.39-.45-3.08-.74-4.93-.78l.84-3.97 2.74.58c.03.62.54 1.11 1.17 1.11zM9.25 13c.69 0 1.25.56 1.25 1.25s-.56 1.25-1.25 1.25-1.25-.56-1.25-1.25.56-1.25 1.25-1.25zm5.5 0c.69 0 1.25.56 1.25 1.25s-.56 1.25-1.25 1.25-1.25-.56-1.25-1.25.56-1.25 1.25-1.25zm-5.46 3.73c.42.3.93.47 1.48.47.55 0 1.06-.17 1.48-.47.16-.11.37-.09.48.06.11.16.08.37-.07.48a3.15 3.15 0 0 1-1.89.58c-.73 0-1.41-.21-1.89-.58a.38.38 0 0 1-.07-.48c.11-.15.32-.17.48-.06z" />
              </svg>
            </button>

            {/* X (Twitter) */}
            <button
              type="button"
              onClick={() => openSocialShare("x")}
              className="grid place-items-center w-8 h-8 rounded-[8px] hover:bg-[var(--hover)] hover:text-[var(--ink)] transition-colors cursor-pointer"
              aria-label="Share on X"
            >
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </button>
          </div>

          {/* Salin tautan */}
          <button
            type="button"
            onClick={handleCopyLink}
            className="flex items-center gap-2 rounded-full px-4 h-9 font-semibold text-xs bg-white text-black hover:bg-white/90 active:scale-[0.98] transition-all cursor-pointer shadow-xs select-none"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-black shrink-0" />
                <span className="text-black font-semibold">{t("projects.copied")}</span>
              </>
            ) : (
              <>
                <Link2 className="w-3.5 h-3.5 text-black shrink-0" />
                <span className="text-black font-semibold">{t("projects.copyLink")}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
}
