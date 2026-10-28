"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/sidebar/sidebar";
import { ChatTopbar } from "./chat-topbar";
import { Composer } from "./composer";
import { MessageList } from "./message-list";
import { Welcome } from "./welcome";
import { useI18n } from "@/providers/i18n-provider";
import { getLocalStorage, setLocalStorage } from "@/lib/storage";
import type { Message, ReasoningLevel } from "@/types";
import sessionsData from "@/data/sessions.json";

const STORAGE_KEY = "devnuby-messages";

const DEFAULT_MODEL_ID = "claude-sonnet-4-5";
const DEFAULT_REASONING: ReasoningLevel = "2";

export function ChatShell() {
  const { t } = useI18n(); 
  const router = useRouter();
  const pathname = usePathname();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Always start from the server-rendered defaults so the first client
  // render matches the HTML; persisted values are applied after mount.
  const [currentModelId, setCurrentModelId] = useState(DEFAULT_MODEL_ID);
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>(DEFAULT_REASONING);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);

  const sessions = sessionsData as any;

  // Read persisted preferences and the selected session after mount.
  useEffect(() => {
    setCurrentModelId(getLocalStorage("devnuby-model", DEFAULT_MODEL_ID));
    setReasoningLevel(getLocalStorage<ReasoningLevel>("devnuby-reasoning", DEFAULT_REASONING));

    if (pathname === "/") {
      setMessages([]);
      return;
    }

    const storedMessages = getLocalStorage<Message[]>(STORAGE_KEY + pathname, []);
    const slug = pathname.replace("/c/", "");
    const session = sessions.find((item: any) => item.slug === slug || item.id === slug);
    setMessages(storedMessages.length > 0 ? storedMessages : (session?.messages ?? []));
  }, [pathname, sessions]);

  useEffect(() => {
    if (pathname !== "/" && messages.length > 0) {
      setLocalStorage(STORAGE_KEY + pathname, messages);
    }
  }, [messages, pathname]);

  const activeSession = useMemo(() => {
    if (pathname === "/") return null;
    const slug = pathname.replace("/c/", "");
    return sessions.find((s: any) => s.slug === slug || s.id === slug);
  }, [pathname, sessions]);

  const currentTitle = activeSession?.title || t("welcome.title");

  const handleSend = useCallback(
    (text: string) => {
      const userMsg: Message = {
        id: `u_${Date.now()}`,
        role: "user",
        content: text,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsThinking(true);

      // Typewriter streaming — chunk the full reply token-by-token for a smooth reveal.
      const fullReply = generateDummyReply(text);
      const aiMsgId = `a_${Date.now()}`;
      const chunkSize = Math.max(2, Math.round(fullReply.length / 140));
      let i = 0;

      window.setTimeout(() => {
        setIsThinking(false);
        setStreamingId(aiMsgId);
        setMessages((prev) => [
          ...prev,
          { id: aiMsgId, role: "assistant", content: "", createdAt: new Date().toISOString() },
        ]);

        const step = () => {
          i += chunkSize;
          const slice = fullReply.slice(0, i);
          setMessages((prev) =>
            prev.map((m) => (m.id === aiMsgId ? { ...m, content: slice } : m))
          );
          if (i < fullReply.length) {
            requestAnimationFrame(step);
          } else {
            setStreamingId(null);
            // Persist once streaming is done
            setMessages((prev) => {
              const finalMsg = prev.find((m) => m.id === aiMsgId);
              if (finalMsg) {
                setLocalStorage(
                  pathname !== "/" ? STORAGE_KEY + pathname : STORAGE_KEY + "/",
                  [...prev]
                );
              }
              return prev;
            });
          }
        };
        requestAnimationFrame(step);
      }, 700);
    },
    [pathname]
  );

  function handleModelChange(id: string) {
    setCurrentModelId(id);
    setLocalStorage("devnuby-model", id);
  }

  function handleReasoningChange(level: ReasoningLevel) {
    setReasoningLevel(level);
    setLocalStorage("devnuby-reasoning", level);
  }

  function handleRegenerate(id: string) {
    const idx = messages.findIndex((m) => m.id === id);
    if (idx === -1) return;
    const userIdx = idx - 1;
    if (messages[userIdx]?.role !== "user") return;
    const userText = messages[userIdx].content;

    // Remove the old assistant reply and start thinking
    const base = messages.slice(0, idx);
    setMessages(base);
    setIsThinking(true);

    const fullReply = generateDummyReply(userText);
    const aiMsgId = `a_${Date.now()}`;
    const chunkSize = Math.max(2, Math.round(fullReply.length / 140));
    let i = 0;

    window.setTimeout(() => {
      setIsThinking(false);
      setStreamingId(aiMsgId);
      setMessages([...base, { id: aiMsgId, role: "assistant", content: "", createdAt: new Date().toISOString() }]);

      const step = () => {
        i += chunkSize;
        const slice = fullReply.slice(0, i);
        setMessages((prev) =>
          prev.map((m) => (m.id === aiMsgId ? { ...m, content: slice } : m))
        );
        if (i < fullReply.length) {
          requestAnimationFrame(step);
        } else {
          setStreamingId(null);
        }
      };
      requestAnimationFrame(step);
    }, 600);
  }

  function handleDeleteChat() {
    if (pathname !== "/") {
      router.push("/");
    }
  }

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[var(--surface)]">
      <Sidebar
        sessions={sessions}
        isCollapsed={isCollapsed}
        onToggleCollapse={() => setIsCollapsed((v) => !v)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <main className="flex flex-col min-w-0 flex-1 grid-rows-[auto_1fr_auto]">
        <ChatTopbar
          title={currentTitle}
          onToggleSidebar={() => {
            if (typeof window !== "undefined" && window.innerWidth <= 768) {
              setMobileOpen(true);
            } else {
              setIsCollapsed((v) => !v);
            }
          }}
          onDelete={handleDeleteChat}
        />

        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <Welcome onSelectPrompt={handleSend} />
          ) : (
            <MessageList
              messages={messages}
              isThinking={isThinking}
              streamingId={streamingId}
              onRegenerate={handleRegenerate}
            />
          )}
        </div>

        <Composer
          onSend={handleSend}
          disabled={isThinking}
          currentModelId={currentModelId}
          onModelChange={handleModelChange}
          reasoningLevel={reasoningLevel}
          onReasoningChange={handleReasoningChange}
        />
      </main>
    </div>
  );
}

// Demo reply generator — replace with real API later
function generateDummyReply(prompt: string): string {
  const p = prompt.toLowerCase();
  if (p.includes("billing") || p.includes("rest") || p.includes("endpoint")) {
    return `Tentu. Untuk API billing dengan **pagination** dan **bearer auth**, pola umumnya seperti ini:

## Contoh permintaan

\`\`\`http
GET /api/v1/invoices?page=2&per_page=20
Authorization: Bearer <token>
Accept: application/json
\`\`\`

## Catatan implementasi

1. Verifikasi token via middleware, jangan di controller.
2. Query dengan \`offset/limit\`, jangan \`SELECT *\`.
3. Kembalikan header \`Link\` rel="next" untuk navigasi kursor.

| Field | Tipe | Wajib | Catatan |
| --- | --- | --- | --- |
| page | int | ya | Mulai dari 1 |
| per_page | int | tidak | Default 20, maks 100 |

Balasan standar: \`{ data: [...], meta: { page, per_page, total } }\``;
  }
  return `## Kerangka jawaban

Pertanyaan bagus. Berikut pendekatan umumnya:

1. **Definisikan tujuan dan batasan** dulu.
2. **Pisahkan** menjadi langkah kecil yang bisa diuji.
3. **Validasi** tiap langkah sebelum lanjut.

\`\`\`text
tujuan → batasan → langkah → validasi → selesai
\`\`\`

Kalau mau, sebutkan konteks tambahan supaya saya bisa turun ke detail konkret.`;
}
