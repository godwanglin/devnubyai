import { Suspense } from "react";
import { UpstreamTab } from "@/components/admin/upstream-tab";

export default function AdminUpstreamPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-[var(--muted)]">Loading upstream catalog...</div>}>
      <UpstreamTab />
    </Suspense>
  );
}
