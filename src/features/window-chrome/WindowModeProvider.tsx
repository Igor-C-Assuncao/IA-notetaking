// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { createContext, useCallback, useContext, useRef, useState, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { useSettings } from "@app/providers/SettingsProvider";

export type WindowMode = "compact" | "expanded" | "wizard" | "bootstrap";

const COMMANDS: Record<WindowMode, string> = {
  compact: "set_compact_mode",
  expanded: "set_expanded_mode",
  wizard: "set_wizard_mode",
  bootstrap: "set_bootstrap_mode",
};

interface WindowModeContextValue {
  mode: WindowMode;
  isExpanded: boolean;
  isTransitioning: boolean;
  setMode: (next: WindowMode) => Promise<void>;
  toggleWindowMode: () => Promise<void>;
}

const WindowModeContext = createContext<WindowModeContextValue | undefined>(undefined);

/**
 * Single owner of the window mode.
 *
 * The OS window geometry lives in Rust and the rendered layout lives in React.
 * When those were two independent sources of truth, anything that invoked a
 * `set_*_mode` command directly — a stray Python event handler, a component
 * remount — resized the window without React knowing, leaving the expanded
 * layout inside a 400x120 pill. Every mode change now flows through `setMode`,
 * which only commits to React state after the Rust command resolves.
 *
 * Mount this ABOVE anything that can unmount the main view, so the mode
 * survives bootstrap phase changes and sidecar restarts.
 */
export function WindowModeProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const [mode, setModeState] = useState<WindowMode>("bootstrap");
  const [isTransitioning, setIsTransitioning] = useState(false);

  // The guard must be a ref, not state: `isTransitioning` is render-scoped, so
  // two triggers in the same tick (hotkey + click, or key autorepeat) both read
  // the pre-update value, both pass, and the window flip-flops.
  const desiredRef = useRef<WindowMode>("bootstrap");
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const inFlightRef = useRef(false);
  const alwaysOnTopRef = useRef(settings.alwaysOnTop);
  alwaysOnTopRef.current = settings.alwaysOnTop;

  const setMode = useCallback(async (next: WindowMode) => {
    if (desiredRef.current === next) return queueRef.current;
    desiredRef.current = next;
    inFlightRef.current = true;
    setIsTransitioning(true);

    queueRef.current = queueRef.current
      .catch(() => {})
      .then(async () => {
        try {
          await invoke(COMMANDS[next]);
          setModeState(next);
          // `set_compact_mode` hardcodes always-on-top; re-apply the user's
          // preference so collapsing to the pill cannot silently override it.
          await getCurrentWindow().setAlwaysOnTop(alwaysOnTopRef.current);
        } catch (error) {
          console.error("Window mode error:", error);
          // Let a later call retry this transition rather than pinning the
          // guard to a mode the window never actually entered.
          if (desiredRef.current === next) desiredRef.current = mode;
        } finally {
          if (desiredRef.current === next) {
            inFlightRef.current = false;
            setIsTransitioning(false);
          }
        }
      });

    return queueRef.current;
  }, [mode]);

  const toggleWindowMode = useCallback(async () => {
    if (inFlightRef.current) return queueRef.current;
    return setMode(desiredRef.current === "expanded" ? "compact" : "expanded");
  }, [setMode]);

  return (
    <WindowModeContext.Provider
      value={{ mode, isExpanded: mode === "expanded", isTransitioning, setMode, toggleWindowMode }}
    >
      {children}
    </WindowModeContext.Provider>
  );
}

export function useWindowModeContext() {
  const context = useContext(WindowModeContext);
  if (!context) throw new Error("useWindowModeContext must be used within WindowModeProvider");
  return context;
}
