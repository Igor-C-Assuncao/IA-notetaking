import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";

import { DEFAULTS } from "@shared/config/defaults";

export interface Settings {
  provider: string;
  modelName: string;
  apiKey: string;
  theme: string;
  language: string;
  systemAudio: boolean;
  autoSummarize: boolean;
  speakerDiarization: boolean;
  alwaysOnTop: boolean;
  onboarding_completed: boolean;
  selectedDeviceId: number | null;
  customModel: string;
  systemPrompt: string;
  obsidianVaultPath: string;
  notionToken: string;
  notionDatabaseId: string;
  ragEnabled: boolean;
  ragProvider: "ollama" | "local";
  ragEmbeddingModel: string;
  ragHistorySynced: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  provider: DEFAULTS.provider,
  modelName: DEFAULTS.model,
  apiKey: "",
  theme: DEFAULTS.theme,
  language: DEFAULTS.language,
  systemAudio: DEFAULTS.systemAudio,
  autoSummarize: DEFAULTS.autoSummarize,
  speakerDiarization: DEFAULTS.speakerDiarization,
  alwaysOnTop: true,
  onboarding_completed: DEFAULTS.onboarding_completed,
  selectedDeviceId: null,
  customModel: "",
  systemPrompt: DEFAULTS.systemPrompt,
  obsidianVaultPath: "",
  notionToken: "",
  notionDatabaseId: "",
  ragEnabled: true,
  ragProvider: "ollama",
  ragEmbeddingModel: "nomic-embed-text",
  ragHistorySynced: false,
};

interface SettingsContextType {
  settings: Settings;
  updateSettings: (partial: Partial<Settings>) => Promise<void>;
  loading: boolean;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    async function init() {
      try {
        const store = await load("settings.json", { autoSave: false, defaults: {} });
        const loaded: Partial<Settings> = {};
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
          const val = await store.get(key);
          if (val !== null && val !== undefined) {
            (loaded as any)[key] = val;
          }
        }
        setSettings((prev) => ({ ...prev, ...loaded }));
      } catch (e) {
        console.error("Failed to load settings:", e);
      } finally {
        setLoading(false);
      }

      // Listen for settings changed in other Tauri windows
      try {
        unlisten = await listen<Partial<Settings>>("settings-changed", (event) => {
          setSettings((prev) => ({ ...prev, ...event.payload }));
        });
      } catch (err) {
        console.error("Failed to listen to settings-changed event:", err);
      }
    }
    init();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const updateSettings = async (partial: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    try {
      const store = await load("settings.json", { autoSave: false, defaults: {} });
      for (const [key, value] of Object.entries(partial)) {
        await store.set(key, value);
      }
      await store.save();
      // Emit settings changed to synchronize all open Tauri webviews
      await emit("settings-changed", partial);
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, loading }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings must be used within SettingsProvider");
  return context;
}
