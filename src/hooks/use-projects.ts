"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProjectDto } from "@/lib/projects/types";

export const PROJECTS_UPDATED_EVENT = "devnuby:projects-updated";

export function dispatchProjectsUpdated() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PROJECTS_UPDATED_EVENT));
  }
}

export function useProjects() {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/projects", { credentials: "same-origin" });
      if (!res.ok) throw new Error("Failed to load projects");
      const json = await res.json();
      if (json.data) {
        setProjects(json.data);
      }
    } catch {
      // keep fallback
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/v1/projects", { credentials: "same-origin" });
        if (!res.ok) throw new Error("Failed to load projects");
        const json = await res.json();
        if (active && json.data) {
          setProjects(json.data);
        }
      } catch {
        // keep fallback
      } finally {
        if (active) setIsLoading(false);
      }
    })();

    const onUpdate = () => {
      void fetchProjects();
    };

    window.addEventListener(PROJECTS_UPDATED_EVENT, onUpdate);
    return () => {
      active = false;
      window.removeEventListener(PROJECTS_UPDATED_EVENT, onUpdate);
    };
  }, [fetchProjects]);

  const createProject = useCallback(
    async (name: string, description?: string): Promise<ProjectDto | null> => {
      const trimmed = name.trim();
      if (!trimmed) return null;

      try {
        const res = await fetch("/api/v1/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed, description }),
          credentials: "same-origin",
        });

        if (!res.ok) throw new Error("Failed to create project");
        const json = await res.json();
        const created: ProjectDto = json.data;
        setProjects((prev) => [created, ...prev]);
        dispatchProjectsUpdated();
        return created;
      } catch {
        return null;
      }
    },
    []
  );

  const renameProject = useCallback(
    async (id: string, newName: string): Promise<boolean> => {
      const trimmed = newName.trim();
      if (!trimmed) return false;

      let prevName: string | undefined;
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id === id) {
            prevName = p.name;
            return { ...p, name: trimmed };
          }
          return p;
        })
      );

      try {
        const res = await fetch(`/api/v1/projects/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
          credentials: "same-origin",
        });

        if (!res.ok) throw new Error("Failed to rename project");
        dispatchProjectsUpdated();
        return true;
      } catch {
        if (prevName !== undefined) {
          setProjects((prev) =>
            prev.map((p) => (p.id === id ? { ...p, name: prevName! } : p))
          );
        }
        return false;
      }
    },
    []
  );

  const togglePinProject = useCallback(
    async (id: string, isPinned: boolean): Promise<boolean> => {
      setProjects((prev) =>
        prev.map((p) => (p.id === id ? { ...p, isPinned } : p))
      );

      try {
        const res = await fetch(`/api/v1/projects/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isPinned }),
          credentials: "same-origin",
        });

        if (!res.ok) throw new Error("Failed to pin project");
        dispatchProjectsUpdated();
        return true;
      } catch {
        setProjects((prev) =>
          prev.map((p) => (p.id === id ? { ...p, isPinned: !isPinned } : p))
        );
        return false;
      }
    },
    []
  );

  const deleteProject = useCallback(
    async (id: string, cascade = false): Promise<boolean> => {
      const existing = projects.find((p) => p.id === id);
      setProjects((prev) => prev.filter((p) => p.id !== id));

      try {
        const res = await fetch(`/api/v1/projects/${id}?cascade=${cascade}`, {
          method: "DELETE",
          credentials: "same-origin",
        });

        if (!res.ok) throw new Error("Failed to delete project");
        dispatchProjectsUpdated();
        return true;
      } catch {
        if (existing) {
          setProjects((prev) => [...prev, existing]);
        }
        return false;
      }
    },
    [projects]
  );

  return {
    projects,
    isLoading,
    fetchProjects,
    createProject,
    renameProject,
    togglePinProject,
    deleteProject,
  };
}
