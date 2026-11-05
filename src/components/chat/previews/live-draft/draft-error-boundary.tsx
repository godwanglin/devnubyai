"use client";

import React from "react";

/** If drawing a draft ever fails, the panel falls back instead of breaking the chat. */
export class DraftErrorBoundary extends React.Component<
  { fallback: React.ReactNode; resetKey: string; children: React.ReactNode },
  { failedKey: string | null }
> {
  state = { failedKey: null as string | null };

  static getDerivedStateFromError(): { failedKey: string } {
    return { failedKey: "__failed__" };
  }

  componentDidCatch(): void {
    // Remember which draft failed: a later draft (more code streamed in) gets a new try
    this.setState({ failedKey: this.props.resetKey });
  }

  render() {
    const { failedKey } = this.state;
    if (failedKey !== null && (failedKey === "__failed__" || failedKey === this.props.resetKey)) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
