"use client";

import { useState, useRef, useEffect, useCallback, useSyncExternalStore } from "react";

export interface UseSpeechRecognitionOptions {
  lang?: string;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultItem {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResultItem;
}

interface SpeechRecognitionEvent {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent {
  error: string;
  message?: string;
}

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

function getSpeechRecognitionClass(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const win = window as unknown as Record<string, unknown>;
  return (
    (win.SpeechRecognition as SpeechRecognitionConstructor) ||
    (win.webkitSpeechRecognition as SpeechRecognitionConstructor) ||
    null
  );
}

function subscribeToSupport() {
  return () => {};
}

function checkSupport(): boolean {
  return Boolean(getSpeechRecognitionClass());
}

export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}) {
  const isSupported = useSyncExternalStore(subscribeToSupport, checkSupport, () => false);
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const start = useCallback(() => {
    if (typeof window === "undefined") return;

    const SpeechClass = getSpeechRecognitionClass();
    if (!SpeechClass) {
      options.onError?.("Browser tidak mendukung Speech Recognition");
      return;
    }

    // Stop if already running
    if (recognitionRef.current) {
      stop();
    }

    try {
      const recognition = new SpeechClass();
      recognitionRef.current = recognition;

      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang =
        options.lang ||
        (navigator.language.startsWith("id") ? "id-ID" : navigator.language) ||
        "id-ID";

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let finalTranscript = "";
        let interimTranscript = "";

        for (let i = 0; i < event.results.length; ++i) {
          const result = event.results[i];
          if (result && result[0]) {
            if (result.isFinal) {
              finalTranscript += result[0].transcript + " ";
            } else {
              interimTranscript += result[0].transcript;
            }
          }
        }

        const combined = (finalTranscript + interimTranscript).trim();
        setTranscript(combined);
        options.onResult?.(combined, Boolean(finalTranscript));
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        if (event.error !== "no-speech") {
          console.warn("[SpeechRecognition] error:", event.error);
          options.onError?.(event.error);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        recognitionRef.current = null;
        options.onEnd?.();
      };

      recognition.start();
    } catch (err) {
      console.error("[SpeechRecognition] Failed to start:", err);
      setIsListening(false);
      options.onError?.(err instanceof Error ? err.message : "Failed to start microphone");
    }
  }, [options, stop]);

  const toggle = useCallback(() => {
    if (isListening) {
      stop();
    } else {
      start();
    }
  }, [isListening, start, stop]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
    };
  }, []);

  return {
    isListening,
    isSupported,
    transcript,
    start,
    stop,
    toggle,
  };
}
