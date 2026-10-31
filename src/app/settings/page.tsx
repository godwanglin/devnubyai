import { Suspense } from "react";
import { SettingsView } from "@/components/settings/settings-view";

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--surface)]" />}>
      <SettingsView />
    </Suspense>
  );
}
