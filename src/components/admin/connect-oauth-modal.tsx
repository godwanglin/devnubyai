"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Copy, Check, ExternalLink, Loader2, AlertCircle } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OAuthProviderId } from "@/lib/oauth/providers";

interface ConnectOAuthModalProps {
  providerId: OAuthProviderId;
  providerName?: string;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface InitData {
  sessionId: string;
  flow: "pkce" | "device_code";
  // PKCE
  authUrl?: string;
  redirectUri?: string;
  loopbackReady?: boolean;
  // Device
  userCode?: string;
  verificationUri?: string;
  verificationUriComplete?: string;
  intervalMs?: number;
}

export function ConnectOAuthModal({
  providerId,
  providerName,
  isOpen,
  onClose,
  onSuccess,
}: ConnectOAuthModalProps) {
  const [loading, setLoading] = useState(true);
  const [initData, setInitData] = useState<InitData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [callbackInput, setCallbackInput] = useState("");
  const [exchanging, setExchanging] = useState(false);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const isMountedRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
  }, []);

  const startPolling = useCallback(
    (sessionId: string, intervalMs: number) => {
      stopPolling();

      pollingRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/v1/admin/gateway/providers/${providerId}/oauth/poll`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sessionId }),
            credentials: "same-origin",
          });
          const json = await res.json().catch(() => ({}));
          if (json.data?.status === "success") {
            stopPolling();
            onSuccess();
            onClose();
          } else if (json.data?.status === "error") {
            stopPolling();
            setError(json.data.error || "Authorization failed");
          }
        } catch {
          // network blip: keep polling
        }
      }, Math.max(2000, intervalMs));
    },
    [onClose, onSuccess, providerId, stopPolling]
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  // Start OAuth session when modal opens
  useEffect(() => {
    if (!isOpen) {
      stopPolling();
      return;
    }

    // Parent mounts this modal per open, so state starts fresh for each login attempt
    let active = true;
    async function startFlow() {
      try {
        const res = await fetch(`/api/v1/admin/gateway/providers/${providerId}/oauth/init`, {
          method: "POST",
          credentials: "same-origin",
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error?.message || "Failed to initialize OAuth flow");
        const sessionData = json.data.session as InitData;
        if (active && isMountedRef.current) {
          setInitData(sessionData);
          startPolling(sessionData.sessionId, sessionData.intervalMs || 4000);
        }
      } catch (err: unknown) {
        if (active && isMountedRef.current) {
          setError(err instanceof Error ? err.message : "Failed to start OAuth");
        }
      } finally {
        if (active && isMountedRef.current) setLoading(false);
      }
    }

    void startFlow();
    return () => {
      active = false;
      stopPolling();
    };
  }, [isOpen, providerId, startPolling, stopPolling]);

  async function handleManualExchange() {
    if (!initData || !callbackInput.trim()) return;
    setExchanging(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/gateway/providers/${providerId}/oauth/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: initData.sessionId,
          callbackInput: callbackInput.trim(),
        }),
        credentials: "same-origin",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || "Exchange failed");
      stopPolling();
      onSuccess();
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Exchange failed");
    } finally {
      setExchanging(false);
    }
  }

  function copyText(text: string, type: "url" | "code") {
    void navigator.clipboard.writeText(text);
    if (type === "url") {
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1500);
    } else {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1500);
    }
  }

  const isGrokCli = providerId === "grok-cli";
  const displayName =
    providerName ||
    (providerId === "antigravity"
      ? "Google Cloud Code Assist (Antigravity)"
      : providerId === "openai"
      ? "OpenAI (ChatGPT)"
      : isGrokCli
      ? "Grok CLI"
      : "xAI");
  const modalTitle = isGrokCli
    ? "Connect Grok CLI (Grok Build)"
    : `Connect ${displayName} OAuth`;

  return (
    <Modal isOpen={isOpen} onClose={onClose} maxWidth="md">
      <div className="space-y-4 text-xs">
        {/* Title */}
        <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
          <h3 className="text-sm font-semibold text-[var(--ink)]">{modalTitle}</h3>
        </div>

        {error && (
          <div className="p-3 rounded-[8px] bg-red-500/10 border border-red-500/20 text-xs text-red-500 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="py-12 text-center space-y-2 text-[var(--muted)]">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-[var(--muted)]" />
            <p>Initializing OAuth session...</p>
          </div>
        ) : isGrokCli ? (
          /* Grok CLI / Device Code view (matches Screenshot 2) */
          <div className="space-y-4">
            <p className="text-[var(--muted)] text-center">Visit the login URL below and authorize:</p>

            <div className="space-y-1">
              <label className="text-[11px] text-[var(--muted)]">Login URL</label>
              <div className="flex items-center gap-1.5 p-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]">
                <span className="flex-1 font-mono text-[11px] text-[var(--ink)] truncate">
                  {initData?.verificationUriComplete || initData?.verificationUri || "..."}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    copyText(initData?.verificationUriComplete || initData?.verificationUri || "", "url")
                  }
                  className="p-1 hover:text-[var(--ink)] text-[var(--muted)]"
                  title="Copy URL"
                >
                  {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    window.open(initData?.verificationUriComplete || initData?.verificationUri || "", "_blank")
                  }
                  className="p-1 hover:text-[var(--ink)] text-[var(--muted)] flex items-center gap-1 text-[11px]"
                  title="Open URL"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open</span>
                </button>
              </div>
            </div>

            {/* Big Code Box styled like screenshot 2 */}
            <div className="p-4 rounded-[10px] bg-neutral-900 border border-neutral-800 text-center space-y-1.5">
              <span className="text-[11px] text-neutral-400">Your Code</span>
              <div className="flex items-center justify-center gap-2">
                <span className="text-2xl font-bold font-mono tracking-wider text-[var(--ink)]">
                  {initData?.userCode || "----"}
                </span>
                {initData?.userCode && (
                  <button
                    type="button"
                    onClick={() => copyText(initData.userCode!, "code")}
                    className="p-1 text-neutral-400 hover:text-white"
                    title="Copy code"
                  >
                    {copiedCode ? (
                      <Check className="w-4 h-4 text-emerald-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </button>
                )}
              </div>
            </div>

            {/* Waiting Spinner */}
            <div className="flex items-center justify-center gap-2 py-2 text-[var(--muted)]">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--muted)]" />
              <span>Waiting for authorization...</span>
            </div>
          </div>
        ) : (
          /* xAI / PKCE View (matches Screenshot 1) */
          <div className="space-y-4">
            {/* Waiting status bar */}
            <div className="p-3 rounded-[8px] bg-neutral-900 border border-neutral-800 flex items-center gap-2.5 text-[var(--muted)]">
              <Loader2 className="w-4 h-4 animate-spin text-[var(--muted)]" />
              <span className="text-neutral-300">Waiting for {displayName} OAuth...</span>
            </div>

            <div className="relative text-center my-3">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[var(--border)]" />
              </div>
              <span className="relative px-2 bg-[var(--panel)] text-[10px] font-semibold text-[var(--muted)] uppercase tracking-wider">
                Or Paste Callback URL Manually
              </span>
            </div>

            {/* Step 1 */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-[var(--ink)]">
                Step 1: Open this {displayName} OAuth URL in your browser
              </label>
              <div className="flex items-center gap-1.5 p-2 rounded-[8px] bg-[var(--surface)] border border-[var(--border)]">
                <span className="flex-1 font-mono text-[11px] text-[var(--muted)] truncate">
                  {initData?.authUrl || "..."}
                </span>
                <button
                  type="button"
                  onClick={() => copyText(initData?.authUrl || "", "url")}
                  className="px-2 py-1 rounded bg-[var(--panel)] border border-[var(--border)] hover:bg-[var(--surface)] text-[var(--ink)] flex items-center gap-1 text-[11px]"
                >
                  {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>Copy</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.open(initData?.authUrl || "", "_blank")}
                  className="px-2 py-1 rounded bg-[var(--panel)] border border-[var(--border)] hover:bg-[var(--surface)] text-[var(--ink)] flex items-center gap-1 text-[11px]"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open</span>
                </button>
              </div>
            </div>

            {/* Step 2 */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-[var(--ink)]">
                Step 2: Paste the callback URL or copied code here
              </label>
              <p className="text-[11px] text-[var(--muted)]">
                If {displayName} shows a code instead of redirecting, paste that code here.
              </p>
              <Input
                placeholder={`${initData?.redirectUri || "http://127.0.0.1:56121/callback"}?code=... or copied code`}
                value={callbackInput}
                onChange={(e) => setCallbackInput(e.target.value)}
                disabled={exchanging}
                className="text-xs font-mono"
              />
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-[var(--border)]">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={exchanging}>
            Cancel
          </Button>
          {!isGrokCli && (
            <Button
              variant="primary"
              size="sm"
              onClick={handleManualExchange}
              disabled={exchanging || !callbackInput.trim()}
             
            >
              {exchanging ? "Connecting..." : "Connect"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
