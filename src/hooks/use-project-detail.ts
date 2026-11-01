"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProjectDetailDto } from "@/lib/projects/types";

export function useProjectDetail(projectId: string | null) {
  const [project, setProject] = useState<ProjectDetailDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!projectId) {
      setProject(null);
      setIsLoading(false);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const res = await fetch(`/api/v1/projects/${projectId}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        throw new Error("Gagal memuat detail proyek");
      }
      const json = await res.json();
      setProject(json.data);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Terjadi kesalahan";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!projectId) {
        setProject(null);
        setIsLoading(false);
        return;
      }
      try {
        setIsLoading(true);
        setError(null);
        const res = await fetch(`/api/v1/projects/${projectId}`, {
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error("Gagal memuat detail proyek");
        const json = await res.json();
        if (active) setProject(json.data);
      } catch (err: unknown) {
        if (active) {
          const msg = err instanceof Error ? err.message : "Terjadi kesalahan";
          setError(msg);
        }
      } finally {
        if (active) setIsLoading(false);
      }
    })();

    const onUpdate = () => {
      void fetchDetail();
    };

    window.addEventListener("devnuby:projects-updated", onUpdate);
    window.addEventListener("devnuby:sessions-updated", onUpdate);
    return () => {
      active = false;
      window.removeEventListener("devnuby:projects-updated", onUpdate);
      window.removeEventListener("devnuby:sessions-updated", onUpdate);
    };
  }, [projectId, fetchDetail]);

  const createChatInProject = useCallback(
    async (title?: string, model?: string): Promise<{ id: string } | null> => {
      if (!projectId) return null;
      try {
        const res = await fetch(`/api/v1/projects/${projectId}/chats`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, model }),
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error("Gagal membuat percakapan");
        const json = await res.json();
        return json.data;
      } catch {
        return null;
      }
    },
    [projectId]
  );

  return {
    project,
    isLoading,
    error,
    refresh: fetchDetail,
    createChatInProject,
  };
}
