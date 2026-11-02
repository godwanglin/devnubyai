"use client";

import { useSyncExternalStore } from "react";

const emptySubscribe = () => () => {};

/**
 * React 19 idiomatic hook to detect client-side mounting without
 * causing hydration mismatches or cascading setState warnings.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}
