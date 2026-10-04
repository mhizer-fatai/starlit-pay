import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type SidebarContextValue = {
  collapsed: boolean;
  toggleCollapsed: () => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

const STORAGE_KEY = "starlit-pay-sidebar-collapsed";
const THEME_KEY = "starlit-pay-theme";

type ThemeMode = "light" | "dark";

type ThemeContextValue = {
  mode: ThemeMode;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mode, setMode] = useState<ThemeMode>(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === "dark") return "dark";
      if (stored === "light") return "light";
    } catch {
      /* storage unavailable */
    }
    return "light";
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {
      /* storage unavailable */
    }
  }, [collapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      /* storage unavailable */
    }
  }, [mode]);

  return (
    <SidebarContext.Provider
      value={{
        collapsed,
        toggleCollapsed: () => setCollapsed((value) => !value),
        mobileOpen,
        setMobileOpen,
      }}
    >
      <ThemeContext.Provider
        value={{
          mode,
          toggleTheme: () => setMode((prev) => (prev === "light" ? "dark" : "light")),
        }}
      >
        {children}
      </ThemeContext.Provider>
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar must be used within SidebarProvider");
  return ctx;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within SidebarProvider");
  return ctx;
}
