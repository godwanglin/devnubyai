"use client";

import React, { useState, useRef, useEffect } from "react";
import { TypingIndicator } from "@/components/chat/typing-indicator";
import { Play, Sparkles, Check } from "lucide-react";

export function DemoSimulator() {
  const [phase, setPhase] = useState<"idle" | "processing" | "thinking" | "tools" | "streaming" | "done" | "exiting">("idle");
  const timersRef = useRef<NodeJS.Timeout[]>([]);

  const clearAll = () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  };

  useEffect(() => clearAll, []);

  const runFullLifecycle = () => {
    clearAll();
    setPhase("processing");
    const t1 = setTimeout(() => setPhase("thinking"), 1400);
    const t2 = setTimeout(() => setPhase("tools"), 2800);
    const t3 = setTimeout(() => setPhase("streaming"), 4200);
    const t4 = setTimeout(() => setPhase("done"), 5600);
    const t5 = setTimeout(() => setPhase("exiting"), 6600); // 1000ms done
    const t6 = setTimeout(() => setPhase("idle"), 6980); // 380ms exit
    timersRef.current = [t1, t2, t3, t4, t5, t6];
  };

  const testDoneOnly = () => {
    clearAll();
    setPhase("done");
    const t1 = setTimeout(() => setPhase("exiting"), 1000);
    const t2 = setTimeout(() => setPhase("idle"), 1380);
    timersRef.current = [t1, t2];
  };

  return (
    <div className="mt-8 rounded-xl bg-[#0B1325]/80 border border-white/10 p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3 mb-4">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-cyan-300" />
            Simulator Siklus Chat & Animasi Loncat
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Uji transisi siklus: Memproses → Thought → Tools → Teks → Selesai (1s) → Loncat & Menyusut.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={runFullLifecycle}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 hover:bg-cyan-500/30 transition cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            Jalankan Siklus Penuh
          </button>
          <button
            type="button"
            onClick={testDoneOnly}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 hover:bg-emerald-500/30 transition cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            Uji Event Done (1 Detik)
          </button>
        </div>
      </div>

      <div className="min-h-[110px] flex items-center justify-center bg-black/30 rounded-lg border border-white/5 p-4">
        {phase === "processing" && (
          <TypingIndicator state="normal" size="md" showLabel={true} labelKey="processing" />
        )}
        {phase === "thinking" && (
          <TypingIndicator state="thinking" size="md" showLabel={true} />
        )}
        {phase === "tools" && (
          <TypingIndicator state="tools" size="md" showLabel={true} />
        )}
        {phase === "streaming" && (
          <div className="flex flex-col gap-1 items-start w-full max-w-md">
            <p className="text-xs text-slate-300 typewriter-fade-in">
              Berikut ini adalah kode implementasi solusi yang sedang digenerate...
            </p>
            <TypingIndicator state="normal" size="md" showLabel={true} className="py-1" />
          </div>
        )}
        {(phase === "done" || phase === "exiting") && (
          <TypingIndicator
            state="done"
            size="md"
            showLabel={true}
            isExiting={phase === "exiting"}
          />
        )}
        {phase === "idle" && (
          <span className="text-xs text-slate-500">
            Klik tombol di atas untuk menjalankan simulasi siklus AI
          </span>
        )}
      </div>
    </div>
  );
}
