"use client";

import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";

interface SidebarContextValue {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  isCollapsed: boolean;
  toggleCollapsed: () => void;
  sidebarWidth: number;
  setSidebarWidth: (width: number) => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  isOpen: false,
  open: () => {},
  close: () => {},
  toggle: () => {},
  isCollapsed: false,
  toggleCollapsed: () => {},
  sidebarWidth: 256,
  setSidebarWidth: () => {},
});

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(256);

  useEffect(() => {
    try {
      const rawCollapsed = window.localStorage.getItem("sidebar:collapsed");
      const rawWidth = window.localStorage.getItem("sidebar:width");
      if (rawCollapsed != null) setIsCollapsed(rawCollapsed === "1");
      if (rawWidth != null) {
        const n = Number(rawWidth);
        if (Number.isFinite(n)) setSidebarWidth(n);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("sidebar:collapsed", isCollapsed ? "1" : "0");
    } catch {
      // ignore
    }
  }, [isCollapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem("sidebar:width", String(sidebarWidth));
    } catch {
      // ignore
    }
  }, [sidebarWidth]);

  const value = useMemo<SidebarContextValue>(
    () => ({
      isOpen,
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen((v) => !v),
      isCollapsed,
      toggleCollapsed: () => setIsCollapsed((v) => !v),
      sidebarWidth,
      setSidebarWidth,
    }),
    [isOpen, isCollapsed, sidebarWidth]
  );
  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  return useContext(SidebarContext);
}
