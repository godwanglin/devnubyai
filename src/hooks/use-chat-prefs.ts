"use client";

import { useCallback, useSyncExternalStore } from "react";
import { getLocalStorage, setLocalStorage } from "@/lib/storage";
import { DEFAULT_RESPONSE_MODE, isResponseMode, type ResponseMode } from "@/lib/preferences/response-mode";
import type { ReasoningLevel } from "@/types";

const DEFAULT_MODEL_ID = "";
const DEFAULT_REASONING: ReasoningLevel = "2";
const MODEL_KEY = "devnuby-model";
const REASONING_KEY = "devnuby-reasoning";
const FILES_PANEL_KEY = "devnuby-files-panel-open";

const prefListeners = new Set<() => void>();

function subscribePrefs(listener: () => void) {
  prefListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    prefListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function writePref<T>(key: string, value: T) {
  setLocalStorage(key, value);
  prefListeners.forEach((l) => l());
}

const readModelPref = () => getLocalStorage(MODEL_KEY, DEFAULT_MODEL_ID);
const readReasoningPref = () => getLocalStorage<ReasoningLevel>(REASONING_KEY, DEFAULT_REASONING);
const readFilesPanelPref = () => getLocalStorage<boolean>(FILES_PANEL_KEY, false) === true;

// Response display (see lib/preferences/response-mode): saved on the account, mirrored
// here so a reload shows the right mode before /me answers
const RESPONSE_MODE_KEY = "devnuby-response-mode";

const readResponseModePref = (): ResponseMode => {
  const value = getLocalStorage<unknown>(RESPONSE_MODE_KEY, DEFAULT_RESPONSE_MODE);
  return isResponseMode(value) ? value : DEFAULT_RESPONSE_MODE;
};

/** Mirrors the account's saved mode (from /me) locally. */
export function applyAccountResponseMode(mode: unknown) {
  if (isResponseMode(mode) && mode !== readResponseModePref()) writePref(RESPONSE_MODE_KEY, mode);
}

/** Switches the mode right away and saves it on the account; reverts if the save fails. */
export async function saveResponseMode(mode: ResponseMode): Promise<boolean> {
  const previous = readResponseModePref();
  writePref(RESPONSE_MODE_KEY, mode);
  try {
    const res = await fetch("/api/v1/me/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ responseMode: mode }),
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error("Failed to save preference");
    return true;
  } catch {
    writePref(RESPONSE_MODE_KEY, previous);
    return false;
  }
}

export function useResponseMode(): ResponseMode {
  return useSyncExternalStore(subscribePrefs, readResponseModePref, () => DEFAULT_RESPONSE_MODE);
}

export function useChatPrefs() {
  const storedModelId = useSyncExternalStore(
    subscribePrefs,
    readModelPref,
    () => DEFAULT_MODEL_ID
  );
  const reasoningLevel = useSyncExternalStore(
    subscribePrefs,
    readReasoningPref,
    () => DEFAULT_REASONING
  );

  // Right files panel stays open across reloads if the user left it open
  const isFilesPanelOpen = useSyncExternalStore(
    subscribePrefs,
    readFilesPanelPref,
    () => false
  );

  const setModelId = useCallback((id: string) => writePref(MODEL_KEY, id), []);
  const setReasoningLevel = useCallback(
    (level: ReasoningLevel) => writePref(REASONING_KEY, level),
    []
  );
  const setFilesPanelOpen = useCallback(
    (open: boolean) => writePref(FILES_PANEL_KEY, open),
    []
  );

  return {
    storedModelId,
    reasoningLevel,
    isFilesPanelOpen,
    setModelId,
    setReasoningLevel,
    setFilesPanelOpen,
  };
}
