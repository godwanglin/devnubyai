import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { DevnubyLoaderCard } from "@/components/brand/devnuby-loader";
import { DemoSimulator } from "./demo-simulator";

export const metadata: Metadata = {
  title: "DevNuby AI Loader Demo — Draft & Laboratory",
  description: "Interactive demo & state testing for DevNuby AI working loaders",
};

export default function DraftDemoPage() {
  return (
    <main className="min-h-screen bg-[#060A14] text-[var(--ink)] px-4 py-8 sm:py-12 flex flex-col items-center">
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Kembali ke Chat
          </Link>
          <span className="text-[11px] font-mono px-2.5 py-0.5 rounded-full border border-cyan-400/30 bg-cyan-500/10 text-cyan-300">
            DRAFT DEMO STUDIO
          </span>
        </div>

        <DevnubyLoaderCard />

        <DemoSimulator />
      </div>
    </main>
  );
}
