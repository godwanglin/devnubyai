"use client";

import React, { useEffect, useState } from "react";
import { ArrowLeft, LogIn, LogOut, KeyRound, Lock, RefreshCw, ShieldCheck } from "lucide-react";
import type { SecurityEventDto } from "@/app/api/v1/user/security-history/route";

interface SecurityHistorySubviewProps {
  onBack: () => void;
}

function formatGroupDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatEventTime(isoString: string): string {
  const d = new Date(isoString);
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${hours}.${minutes}`;
}

export function SecurityHistorySubview({ onBack }: SecurityHistorySubviewProps) {
  const [events, setEvents] = useState<SecurityEventDto[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    fetch("/api/v1/user/security-history")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (active && json?.data?.events) {
          setEvents(json.data.events);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // Group events by date string
  const groupedEvents: Record<string, SecurityEventDto[]> = {};
  for (const ev of events) {
    const key = formatGroupDate(ev.timestamp);
    if (!groupedEvents[key]) {
      groupedEvents[key] = [];
    }
    groupedEvents[key].push(ev);
  }

  const groupKeys = Object.keys(groupedEvents);

  const getEventIcon = (type: SecurityEventDto["type"]) => {
    switch (type) {
      case "logout":
        return <LogOut className="w-4 h-4 text-[var(--muted)]" />;
      case "password_change":
        return <KeyRound className="w-4 h-4 text-[var(--accent)]" />;
      case "pin_change":
        return <Lock className="w-4 h-4 text-[var(--accent)]" />;
      case "login":
      default:
        return <LogIn className="w-4 h-4 text-[var(--muted)]" />;
    }
  };

  return (
    <div className="space-y-5">
      {/* Back button */}
      <div className="flex items-center gap-3 pb-3 border-b border-[var(--border)]">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-[var(--muted)] hover:text-[var(--ink)] transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kembali ke Keamanan</span>
        </button>
      </div>

      <div>
        <h3 className="text-base sm:text-lg font-semibold text-[var(--ink)]">
          Riwayat keamanan
        </h3>
        <p className="text-xs text-[var(--muted)] mt-1 leading-relaxed">
          Tinjau aktivitas login dan perubahan pada pengaturan keamanan Anda.
        </p>
      </div>

      {loading ? (
        <div className="py-12 text-center text-xs text-[var(--muted)] flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-[var(--muted)]" />
          <span>Memuat riwayat keamanan...</span>
        </div>
      ) : groupKeys.length === 0 ? (
        <div className="p-8 text-center text-xs text-[var(--muted)] rounded-[12px] border border-[var(--border)] bg-[var(--panel-elevated)] space-y-2">
          <ShieldCheck className="w-6 h-6 mx-auto text-emerald-500" />
          <p>Belum ada catatan aktivitas keamanan yang tercatat.</p>
        </div>
      ) : (
        <div className="space-y-6 pt-1">
          {groupKeys.map((dateKey) => (
            <div key={dateKey} className="space-y-2">
              <h4 className="text-xs sm:text-sm font-semibold text-[var(--ink)]">
                {dateKey}
              </h4>

              <div className="space-y-2">
                {groupedEvents[dateKey]?.map((ev) => (
                  <div
                    key={ev.id}
                    className="p-3.5 sm:p-4 rounded-[14px] border border-[var(--border)] bg-[var(--panel-elevated)] flex items-center gap-3.5 hover:border-[var(--glass-border)] transition-colors"
                  >
                    <div className="w-8 h-8 rounded-[8px] bg-[var(--hover)] grid place-items-center shrink-0">
                      {getEventIcon(ev.type)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-xs sm:text-sm font-semibold text-[var(--ink)] truncate">
                        {ev.title}
                      </p>
                      <p className="text-[11px] sm:text-xs text-[var(--muted)] mt-0.5 truncate">
                        <span>{ev.deviceLabel}</span>
                        {" • "}
                        <span>{formatEventTime(ev.timestamp)}</span>
                        {" • "}
                        <span>{ev.location}</span>
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
