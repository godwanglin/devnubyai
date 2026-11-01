"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function SettingsRedirectContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const tab = searchParams.get("tab");
    const targetHash = tab ? `#/settings/${tab}` : "#/settings";
    router.replace(`/${targetHash}`);
  }, [router, searchParams]);

  return <div className="min-h-screen bg-[var(--surface)]" />;
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[var(--surface)]" />}>
      <SettingsRedirectContent />
    </Suspense>
  );
}
