"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/providers/i18n-provider";
import { SecurityMainList } from "./security/security-main-list";
import { ActiveSessionsSubview, type SessionItem } from "./security/active-sessions-subview";
import { PasswordModal } from "./security/password-modal";
import { PinModal } from "./security/pin-modal";
import { PasskeyModal } from "./security/passkey-modal";
import { SecurityHistoryModal } from "./security/security-history-modal";

export function SecurityTab() {
  const { t } = useI18n();

  // Navigation: main list vs sub-tab (sessions)
  const [subView, setSubView] = useState<"main" | "sessions">("main");

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
  const [showHistoryModal, setShowHistoryModal] = useState(false);

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
      {subView === "main" && (
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
      {subView === "sessions" ? (
        <ActiveSessionsSubview
          sessions={sessions}
          loading={loadingSessions}
          onBack={() => setSubView("main")}
          onRefresh={loadSessions}
        />
      ) : (
        <SecurityMainList
          sessions={sessions}
          hasPassword={hasPassword}
          hasPin={hasPin}
          onOpenPasskeys={() => setShowPasskeysModal(true)}
          onOpenPassword={() => setShowPasswordModal(true)}
          onOpenPin={() => setShowPinModal(true)}
          onNavigateToSessions={() => setSubView("sessions")}
          onOpenHistory={() => setShowHistoryModal(true)}
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

      <SecurityHistoryModal
        isOpen={showHistoryModal}
        onClose={() => setShowHistoryModal(false)}
      />
    </div>
  );
}
