import { Suspense } from "react";
import { ChatShell } from "@/components/chat/chat-shell";
import sessionsData from "@/data/sessions.json";

export function generateStaticParams() {
  return sessionsData.map((s) => ({
    id: s.slug || s.id,
  }));
}

export default async function ChatSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await params;
  return (
    <Suspense fallback={<div className="h-[100dvh] bg-[var(--surface)]" />}>
      <ChatShell />
    </Suspense>
  );
}
