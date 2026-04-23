"use client";
import { createContext, useContext, useState, ReactNode } from "react";

interface NavbarCountContextValue {
  showingCount: number | null;
  setShowingCount: (n: number | null) => void;
}

const NavbarCountContext = createContext<NavbarCountContextValue>({
  showingCount: null,
  setShowingCount: () => {},
});

export function NavbarCountProvider({ children }: { children: ReactNode }) {
  const [showingCount, setShowingCount] = useState<number | null>(null);
  return (
    <NavbarCountContext.Provider value={{ showingCount, setShowingCount }}>
      {children}
    </NavbarCountContext.Provider>
  );
}

export function useNavbarCount() {
  return useContext(NavbarCountContext);
}
