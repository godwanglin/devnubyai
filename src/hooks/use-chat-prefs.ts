"use client";

import { useCallback, useSyncExternalStore } from "react";
import { getLocalStorage, setLocalStorage } from "@/lib/storage";
import type { ReasoningLevel } from "@/types";

const DEFAULT_MODEL_ID = "";
const DEFAULT_REASONING: ReasoningLevel = "2";
const MODEL_KEY = "devnuby-model";
const REASONING_KEY = "devnuby-reasoning";

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

  const setModelId = useCallback((id: string) => writePref(MODEL_KEY, id), []);
  const setReasoningLevel = useCallback(
    (level: ReasoningLevel) => writePref(REASONING_KEY, level),
    []
  );

  return {
    storedModelId,
    reasoningLevel,
    setModelId,
    setReasoningLevel,
  };
}
