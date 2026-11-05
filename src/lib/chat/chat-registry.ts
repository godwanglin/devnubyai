"use client";

import { Chat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { CLIENT_ERROR_REQUEST_ID_PREFIX } from "./client-error";
import { messageErrorRequestIdMap } from "./client-mappers";
import { chatTransport } from "./transport";

/**
 * One AI SDK `Chat` per chat session, kept for the whole page load.
 *
 * Every session streams into its own instance, so a reply that is still being
 * generated for chat A keeps going (and keeps its messages) while the user opens
 * chat B or starts a new one, and it never shows up in B. The home page uses a
 * fresh "draft" instance; when its first message creates a session, the draft is
 * re-keyed to that session's id.
 *
 * The registry also tracks which sessions are working (sidebar spinner) and which
 * finished while the user was elsewhere (sidebar dot, cleared when opened).
 */

export interface ChatEvents {
  onData?: (chatId: string | null, part: { type: string; data?: unknown }) => void;
  onError?: (chatId: string | null, error: Error) => void;
  onFinish?: (chatId: string | null, info: { messages: UIMessage[]; isAbort: boolean; isError: boolean }) => void;
}

interface Entry {
  chat: Chat<UIMessage>;
  /** Session public id; null while it is still a home-page draft */
  holder: { chatId: string | null };
}

const entries = new Map<string, Entry>();
let events: ChatEvents = {};
let draftCounter = 0;

export function setChatEvents(next: ChatEvents): void {
  events = next;
}

function createEntry(chatId: string | null): Entry {
  const holder = { chatId };
  const chat = new Chat<UIMessage>({
    transport: chatTransport,
    onData: (part) => events.onData?.(holder.chatId, part as { type: string; data?: unknown }),
    onError: (error) => {
      if (holder.chatId) setActivity(holder.chatId, "done");
      // A failed reply that wrote nothing would leave an empty bubble. The error text the
      // server sends is the friendly line (the real trace stays in the database), so it
      // becomes the message content until the next reload reads the stored one.
      const raw = error instanceof Error ? error.message.trim() : "";
      const markerAt = raw.lastIndexOf(CLIENT_ERROR_REQUEST_ID_PREFIX);
      const requestId = markerAt >= 0 ? raw.slice(markerAt + CLIENT_ERROR_REQUEST_ID_PREFIX.length).trim() : "";
      const text = (markerAt >= 0 ? raw.slice(0, markerAt) : raw).trim();
      if (text) {
        const messages = chat.messages;
        const last = messages[messages.length - 1];
        const hasText = last?.role === "assistant" && last.parts.some((p) => p.type === "text" && p.text.trim());
        if (last?.role === "assistant" && !hasText) {
          if (requestId) messageErrorRequestIdMap.set(last.id, requestId);
          chat.messages = [
            ...messages.slice(0, -1),
            { ...last, parts: [...last.parts, { type: "text", text, state: "done" }] },
          ];
        }
      }
      events.onError?.(holder.chatId, error);
    },
    onFinish: ({ messages, isAbort, isError }) => {
      if (holder.chatId) setActivity(holder.chatId, "done");
      events.onFinish?.(holder.chatId, { messages, isAbort, isError });
    },
  });
  return { chat, holder };
}

/** Key of a fresh home-page draft (call again to get another one). */
export function newDraftKey(): string {
  draftCounter += 1;
  return `draft:${draftCounter}`;
}

/** The Chat for a session id or draft key, created on first use. */
export function getChat(key: string): Chat<UIMessage> {
  let entry = entries.get(key);
  if (!entry) {
    entry = createEntry(key.startsWith("draft:") ? null : key);
    entries.set(key, entry);
  }
  return entry.chat;
}

// Sessions created in this page load: their messages only ever exist here first,
// so opening them never needs (or waits for) a load from the server
const createdHere = new Set<string>();

/** A draft just created its session: from now on it belongs to `chatId`. */
export function promoteDraft(draftKey: string, chatId: string): Chat<UIMessage> {
  const entry = entries.get(draftKey) ?? createEntry(null);
  entries.delete(draftKey);
  entry.holder.chatId = chatId;
  entries.set(chatId, entry);
  createdHere.add(chatId);
  return entry.chat;
}

export function wasCreatedHere(chatId: string): boolean {
  return createdHere.has(chatId);
}

/** Forget a session (deleted chat): stops a running reply and drops its state. */
export function disposeChat(chatId: string): void {
  const entry = entries.get(chatId);
  if (!entry) return;
  void entry.chat.stop();
  entries.delete(chatId);
  clearActivity(chatId);
}

export function isChatBusy(chatId: string): boolean {
  const status = entries.get(chatId)?.chat.status;
  return status === "submitted" || status === "streaming";
}

// ── Sidebar activity: "working" (spinner) / "done" (unseen result, dot) ──────

type Activity = "working" | "done";
const activity = new Map<string, Activity>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, Activity> = new Map();
let viewedChatId: string | null = null;

function emit() {
  snapshot = new Map(activity);
  listeners.forEach((l) => l());
}

function setActivity(chatId: string, state: Activity) {
  // A reply that finishes in the open chat has been seen already
  if (state === "done" && chatId === viewedChatId) {
    if (activity.delete(chatId)) emit();
    return;
  }
  if (activity.get(chatId) === state) return;
  activity.set(chatId, state);
  emit();
}

function clearActivity(chatId: string) {
  if (activity.delete(chatId)) emit();
}

/** A generation started for this session (send, regenerate or reattach). */
export function markWorking(chatId: string): void {
  setActivity(chatId, "working");
}

/** The user is looking at this session: its "done" dot goes away. */
export function setViewedChat(chatId: string | null): void {
  viewedChatId = chatId;
  if (chatId && activity.get(chatId) === "done") clearActivity(chatId);
}

export function subscribeActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getActivitySnapshot(): ReadonlyMap<string, Activity> {
  return snapshot;
}

const EMPTY: ReadonlyMap<string, Activity> = new Map();
export function getServerActivitySnapshot(): ReadonlyMap<string, Activity> {
  return EMPTY;
}

/** Sessions generating right now in this tab. */
export function countWorkingChats(): number {
  let n = 0;
  for (const state of activity.values()) if (state === "working") n += 1;
  return n;
}
