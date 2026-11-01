"use client";

import React, { useState } from "react";
import {
  Globe,
  Lock,
  Check,
  Link2,
  Info,
  X,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Popover } from "@/components/ui/popover";
import { useI18n } from "@/providers/i18n-provider";
import { useAccount } from "@/providers/account-provider";
import { useToast } from "@/providers/toast-provider";
import type { ProjectDto } from "@/lib/projects/types";

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
    project.shareAccess || "anyone"
  );
  const [invitedList, setInvitedList] = useState<string[]>(
    project.invitedEmails || []
  );
  const [accessDropdownOpen, setAccessDropdownOpen] = useState(false);
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

  function handleAddEmails(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const raw = emailInput.trim();
    if (!raw) return;

    const emails = raw
      .split(/[,;\s]+/)
      .map((x) => x.trim().toLowerCase())
      .filter((x) => x && x.includes("@") && !invitedList.includes(x));

    if (emails.length === 0) return;

    const updated = [...invitedList, ...emails];
    setInvitedList(updated);
    setEmailInput("");
    void handleSaveShare(access, updated);
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
        <form onSubmit={handleAddEmails} className="relative flex items-center">
          <input
            type="text"
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddEmails();
              }
            }}
            placeholder={t("projects.emailInvitePlaceholder")}
            className="w-full h-10 px-3.5 rounded-[10px] border border-[var(--border)] bg-[var(--panel-elevated)] text-xs text-[var(--ink)] placeholder:text-[var(--placeholder)] focus:border-[var(--accent)] outline-none"
          />
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
                className="flex items-center justify-between w-full px-2.5 py-2 rounded-[6px] text-xs text-left hover:bg-[var(--hover)] text-[var(--ink)] transition-colors"
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
                className="flex items-center justify-between w-full px-2.5 py-2 rounded-[6px] text-xs text-left hover:bg-[var(--hover)] text-[var(--ink)] transition-colors"
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
