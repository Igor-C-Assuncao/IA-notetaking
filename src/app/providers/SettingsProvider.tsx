import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { load } from "@tauri-apps/plugin-store";

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
    }
    init();
  }, []);

  const updateSettings = async (partial: Partial<Settings>) => {
    setSettings((prev) => ({ ...prev, ...partial }));
    try {
      const store = await load("settings.json", { autoSave: false, defaults: {} });
      for (const [key, value] of Object.entries(partial)) {
        await store.set(key, value);
      }
      await store.save();
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
