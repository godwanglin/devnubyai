"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Old login URL opens the same popup, so bookmarks still work. */
export default function LoginPage() {
  const router = useRouter();
  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get("next");
    const search = next ? `?next=${encodeURIComponent(next)}` : "";
    router.replace(`/${search}#/authenticate`);
  }, [router]);
  return null;
}
