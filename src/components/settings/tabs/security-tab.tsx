"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/providers/i18n-provider";
import { SecurityMainList } from "./security/security-main-list";
import { ActiveSessionsSubview, type SessionItem } from "./security/active-sessions-subview";
import { SecurityHistorySubview } from "./security/security-history-subview";
import { PasswordModal } from "./security/password-modal";
import { PinModal } from "./security/pin-modal";
import { PasskeyModal } from "./security/passkey-modal";

export interface SecurityTabProps {
  currentSubView?: "main" | "sessions" | "history";
  onSubViewChange?: (sub: "main" | "sessions" | "history") => void;
}

export function SecurityTab({
  currentSubView,
  onSubViewChange,
}: SecurityTabProps) {
  const { t } = useI18n();

  // Internal fallback state if no parent controller is provided
  const [internalSubView, setInternalSubView] = useState<"main" | "sessions" | "history">("main");

  const effectiveSubView = currentSubView ?? internalSubView;

  const handleSubViewChange = (sub: "main" | "sessions" | "history") => {
    if (onSubViewChange) {
      onSubViewChange(sub);
    } else {
      setInternalSubView(sub);
    }
  };

  // Sessions state
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);

  // Security features state
  const [hasPassword, setHasPassword] = useState<boolean>(false);
  const [hasPin, setHasPin] = useState<boolean>(false);

  // Modals state
  const [showPasskeysModal, setShowPasskeysModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);

  // Load sessions helper
  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/user/sessions");
      if (res.ok) {
        const json = await res.json();
        setSessions(json.data?.sessions || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    let active = true;

    fetch("/api/v1/user/sessions")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (active && json?.data?.sessions) {
          setSessions(json.data.sessions);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoadingSessions(false);
      });

    fetch("/api/v1/user/password")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (active && json?.data) {
          setHasPassword(Boolean(json.data.hasPassword));
        }
      })
      .catch(() => {});

    fetch("/api/v1/user/pin")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (active && json?.data) {
          setHasPin(Boolean(json.data.hasPin));
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      {effectiveSubView === "main" && (
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">
            {t("settings.securityTab")}
          </h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Kelola cara Anda masuk, autentikasi multifaktor, dan tinjau sesi perangkat Anda.
          </p>
        </div>
      )}

      {/* Main List or Sub-View */}
      {effectiveSubView === "sessions" ? (
        <ActiveSessionsSubview
          sessions={sessions}
          loading={loadingSessions}
          onBack={() => handleSubViewChange("main")}
          onRefresh={loadSessions}
        />
      ) : effectiveSubView === "history" ? (
        <SecurityHistorySubview
          onBack={() => handleSubViewChange("main")}
        />
      ) : (
        <SecurityMainList
          sessions={sessions}
          hasPassword={hasPassword}
          hasPin={hasPin}
          onOpenPasskeys={() => setShowPasskeysModal(true)}
          onOpenPassword={() => setShowPasswordModal(true)}
          onOpenPin={() => setShowPinModal(true)}
          onNavigateToSessions={() => handleSubViewChange("sessions")}
          onNavigateToHistory={() => handleSubViewChange("history")}
        />
      )}

      {/* Modals */}
      <PasskeyModal
        isOpen={showPasskeysModal}
        onClose={() => setShowPasskeysModal(false)}
      />

      <PasswordModal
        isOpen={showPasswordModal}
        onClose={() => setShowPasswordModal(false)}
        hasPassword={hasPassword}
        onSuccess={() => setHasPassword(true)}
      />

      <PinModal
        isOpen={showPinModal}
        onClose={() => setShowPinModal(false)}
        hasPin={hasPin}
        onSuccess={() => setHasPin(true)}
      />
    </div>
  );
}
