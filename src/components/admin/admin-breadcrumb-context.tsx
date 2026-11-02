"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

export interface BreadcrumbSegment {
  label: string;
  href?: string;
}

interface AdminBreadcrumbContextValue {
  segments: BreadcrumbSegment[];
  setSegments: (segments: BreadcrumbSegment[]) => void;
}

const AdminBreadcrumbContext = createContext<AdminBreadcrumbContextValue>({
  segments: [],
  setSegments: () => {},
});

export function AdminBreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [segments, setSegments] = useState<BreadcrumbSegment[]>([]);
  return (
    <AdminBreadcrumbContext.Provider value={{ segments, setSegments }}>
      {children}
    </AdminBreadcrumbContext.Provider>
  );
}

export function useAdminBreadcrumb() {
  return useContext(AdminBreadcrumbContext);
}

/** Hook for a page to declare its custom topbar breadcrumbs. Cleans up on unmount. */
export function useSetAdminBreadcrumb(segments: BreadcrumbSegment[]) {
  const { setSegments } = useAdminBreadcrumb();

  useEffect(() => {
    setSegments(segments);
    return () => setSegments([]);
    // Serialized dependency so caller can pass inline array without re-triggering loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(segments), setSegments]);
}
