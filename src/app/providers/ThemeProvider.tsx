// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { createContext, useContext, useEffect, ReactNode } from "react";
import { useSettings } from "./SettingsProvider";

interface ThemeContextType {
  theme: string;
  isLG: boolean;
  waveColor: string;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings, loading } = useSettings();
  
  const theme = settings.theme;
  const isLG = theme !== "minimalist-notebook";
  const waveColor = isLG ? "rgba(255,255,255,0.92)" : "#1a1814";

  useEffect(() => {
    if (!loading) {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, [theme, loading]);

  return (
    <ThemeContext.Provider value={{ theme, isLG, waveColor }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within ThemeProvider");
  return context;
}
