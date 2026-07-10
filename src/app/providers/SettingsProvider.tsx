// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { load } from "@tauri-apps/plugin-store";
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

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
  hf_token: string;
  engineKind: "cpu" | "gpu";
  engineVersion: string;
  engineInstalled: boolean;
  enginePath: string;
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
  hf_token: "",
  engineKind: "cpu",
  engineVersion: "0.1.0",
  engineInstalled: false,
  enginePath: "",
};

interface SettingsContextType {
  settings: Settings;
  updateSettings: (partial: Partial<Settings>) => Promise<void>;
  getProviderApiKey: (provider: string) => Promise<string>;
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
          if (key === "apiKey" || key === "notionToken" || key === "hf_token") {
            continue;
          }
          const val = await store.get(key);
          if (val !== null && val !== undefined) {
            (loaded as any)[key] = val;
          }
        }

        // Asynchronously retrieve secrets from the OS Keychain
        const activeProvider = loaded.provider || DEFAULT_SETTINGS.provider;
        let activeKey = "";
        try {
          activeKey = await invoke<string | null>("get_secret", { key: `${activeProvider.toLowerCase()}_api_key` }) || "";
        } catch (err) {
          console.error("Failed to read apiKey from keychain:", err);
        }

        let notionToken = "";
        try {
          notionToken = await invoke<string | null>("get_secret", { key: "notion_token" }) || "";
        } catch (err) {
          console.error("Failed to read notionToken from keychain:", err);
        }

        let hfToken = "";
        try {
          hfToken = await invoke<string | null>("get_secret", { key: "hf_token" }) || "";
        } catch (err) {
          console.error("Failed to read hf_token from keychain:", err);
        }

        loaded.apiKey = activeKey;
        loaded.notionToken = notionToken;
        loaded.hf_token = hfToken;

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

  const getProviderApiKey = async (provider: string) => {
    const normalizedProvider = provider.trim().toLowerCase();
    if (!normalizedProvider || normalizedProvider === "ollama") {
      return "";
    }
    return await invoke<string | null>("get_secret", {
      key: `${normalizedProvider}_api_key`,
    }) || "";
  };

  const updateSettings = async (partial: Partial<Settings>) => {
    const nextSettings = { ...partial };

    // If provider changed, fetch and synchronize the corresponding apiKey in memory
    if (nextSettings.provider && nextSettings.apiKey === undefined) {
      try {
        nextSettings.apiKey = await getProviderApiKey(nextSettings.provider);
      } catch (e) {
        console.error("Failed to fetch LLM key for provider change:", e);
        throw e;
      }
    }

    const previousSettings = settings;
    setSettings((prev) => ({ ...prev, ...nextSettings }));

    try {
      const store = await load("settings.json", { autoSave: false, defaults: {} });
      for (const [key, value] of Object.entries(nextSettings)) {
        if (key === "apiKey") {
          const activeProvider = nextSettings.provider || settings.provider;
          await invoke("set_secret", { key: `${activeProvider.toLowerCase()}_api_key`, value: value as string });
        } else if (key === "notionToken") {
          await invoke("set_secret", { key: "notion_token", value: value as string });
        } else if (key === "hf_token") {
          await invoke("set_secret", { key: "hf_token", value: value as string });
        } else {
          await store.set(key, value);
        }
      }
      await store.save();
      // Emit settings changed to synchronize all open Tauri webviews
      await emit("settings-changed", nextSettings);
    } catch (e) {
      console.error("Failed to save settings:", e);
      setSettings(previousSettings);
      throw e;
    }
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, getProviderApiKey, loading }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) throw new Error("useSettings must be used within SettingsProvider");
  return context;
}
