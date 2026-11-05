"use client";

import { useCallback, useRef, useState } from "react";
import { FILES_PANEL_CHAT_MIN_WIDTH } from "@/lib/files/panel-layout";
import { getLocalStorage } from "@/lib/storage";

/** Below this chat width (with the left sidebar open) a wide files panel folds the sidebar away */
const CHAT_MIN_WIDTH_WITH_SIDEBAR = 560;
const REOPEN_HYSTERESIS = 40;
const SIDEBAR_WIDTH_KEY = "devnuby-sidebar-width";
const SIDEBAR_DEFAULT_WIDTH = 272;

/**
 * Desktop collapse state of the left sidebar. A wide files panel folds it away so the
 * chat keeps a usable width; it comes back once the panel narrows again (or closes),
 * unless the user toggled it themselves in between.
 */
export function useSidebarAutoCollapse() {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const autoCollapsedRef = useRef(false);

  const toggleCollapsed = useCallback(() => {
    autoCollapsedRef.current = false;
    setIsCollapsed((v) => !v);
  }, []);

  const handleFilesPanelWidth = useCallback((panelWidth: number | null) => {
    if (typeof window === "undefined" || window.innerWidth <= 768) return;
    if (panelWidth === null) {
      if (autoCollapsedRef.current) {
        autoCollapsedRef.current = false;
        setIsCollapsed(false);
      }
      return;
    }
    const viewport = window.innerWidth;
    const renderedPanel = Math.min(panelWidth, viewport - FILES_PANEL_CHAT_MIN_WIDTH);
    const stored = getLocalStorage<number>(SIDEBAR_WIDTH_KEY, SIDEBAR_DEFAULT_WIDTH);
    const sidebarWidth = Math.min(typeof stored === "number" ? stored : SIDEBAR_DEFAULT_WIDTH, viewport * 0.32);
    const chatWithSidebar = viewport - renderedPanel - sidebarWidth;
    if (chatWithSidebar < CHAT_MIN_WIDTH_WITH_SIDEBAR) {
      setIsCollapsed((collapsed) => {
        if (!collapsed) autoCollapsedRef.current = true;
        return true;
      });
    } else if (autoCollapsedRef.current && chatWithSidebar >= CHAT_MIN_WIDTH_WITH_SIDEBAR + REOPEN_HYSTERESIS) {
      autoCollapsedRef.current = false;
      setIsCollapsed(false);
    }
  }, []);

  return { isCollapsed, toggleCollapsed, handleFilesPanelWidth };
}
