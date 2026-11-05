"use client";

import { useEffect, useRef, useState } from "react";
import { buildDraft, type DraftDocument } from "@/lib/live-draft";

const REBUILD_INTERVAL_MS = 280;

interface DraftRequest {
  /** Tool call the draft belongs to */
  callId: string | null;
  toolName: string;
  input: unknown;
  streaming: boolean;
}

/**
 * Draft of the document a tool call is building, rebuilt at most every ~280ms while
 * its input streams in (parsing the whole script on every token would stall the UI).
 */
export function useLiveDraft({ callId, toolName, input, streaming }: DraftRequest): { draft: DraftDocument | null; version: number } {
  const [state, setState] = useState<{ draft: DraftDocument | null; version: number; callId: string | null }>({
    draft: null,
    version: 0,
    callId: null,
  });
  const latest = useRef<DraftRequest>({ callId, toolName, input, streaming });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRun = useRef(0);

  useEffect(() => {
    latest.current = { callId, toolName, input, streaming };
    if (timer.current) return;
    const wait = Math.max(0, REBUILD_INTERVAL_MS - (Date.now() - lastRun.current));
    timer.current = setTimeout(() => {
      timer.current = null;
      lastRun.current = Date.now();
      const current = latest.current;
      const draft = current.callId ? buildDraft({ toolName: current.toolName, input: current.input }, current.streaming) : null;
      setState((prev) => {
        // A half-written statement can make one rebuild come out empty: keep the last
        // draft of the same call on screen instead of blinking to nothing and back
        if (!draft && prev.callId === current.callId && prev.draft) return prev;
        return { draft, version: prev.version + 1, callId: current.callId };
      });
    }, wait);
  }, [callId, toolName, input, streaming]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      // Strict Mode remounts: a cleared timer must not block the next schedule
      timer.current = null;
    },
    []
  );

  // A draft of another tool call is never shown, even before the next rebuild
  return state.callId === callId ? { draft: state.draft, version: state.version } : { draft: null, version: state.version };
}
