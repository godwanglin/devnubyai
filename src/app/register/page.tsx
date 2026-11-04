"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Register uses the same popup; the email step decides login vs signup. */
export default function RegisterPage() {
  const router = useRouter();
  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get("next");
    const search = next ? `?next=${encodeURIComponent(next)}` : "";
    router.replace(`/${search}#/authenticate`);
  }, [router]);
  return null;
}
