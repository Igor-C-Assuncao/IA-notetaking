import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PopoverWidget } from "./PopoverWidget";

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "request_audio_devices") return { devices: [] };
    return null;
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    close: vi.fn(),
  })),
}));

// Mock IpcProvider hook
vi.mock("@app/providers/IpcProvider", () => ({
  usePythonEvent: vi.fn(),
}));

// Mock ThemeProvider hook
vi.mock("@app/providers/ThemeProvider", () => ({
  useTheme: () => ({
    isLG: true,
  }),
}));

// Create mutable settings for testing updates
let mockSettings = {
  provider: "ollama",
  modelName: "llama3",
  apiKey: "",
  theme: "liquid-glass",
  language: "en",
  systemAudio: false, // Default is false to verify toggle can activate it
  autoSummarize: false,
  speakerDiarization: false,
  alwaysOnTop: true,
  onboarding_completed: true,
  selectedDeviceId: null,
  customModel: "",
  systemPrompt: "",
  obsidianVaultPath: "",
  notionToken: "",
  notionDatabaseId: "",
  ragEnabled: false,
  ragProvider: "ollama" as const,
  ragEmbeddingModel: "nomic-embed-text",
  ragHistorySynced: false,
  hf_token: "",
};

const mockUpdateSettings = vi.fn(async (updated: any) => {
  mockSettings = { ...mockSettings, ...updated };
});

vi.mock("@app/providers/SettingsProvider", () => ({
  useSettings: () => ({
    settings: mockSettings,
    updateSettings: mockUpdateSettings,
    loading: false,
  }),
}));

describe("PopoverWidget Toggle Components", () => {
  beforeEach(() => {
    mockSettings.systemAudio = false;
    mockSettings.autoSummarize = false;
    mockSettings.speakerDiarization = false;
    mockSettings.alwaysOnTop = true;
    mockSettings.ragEnabled = false;
    mockUpdateSettings.mockClear();
  });

  test("verifies that PopoverWidget is rendered and the system audio toggle can be clicked to update state", async () => {
    render(<PopoverWidget />);

    // Verify "Audio" tab is active by default and contains System Audio toggle
    const toggle = screen.getByRole("switch");
    
    // Check initial state (should be false/unchecked)
    // NOTE: This will fail or pass based on whether Toggle component properties are correctly passed.
    expect(toggle).toHaveAttribute("aria-checked", "false");

    // Click the toggle to switch system audio to true
    fireEvent.click(toggle);

    // Verify toggle reflects the updated state
    expect(toggle).toHaveAttribute("aria-checked", "true");

    // Click "Save Changes" and verify updateSettings is called with systemAudio: true
    const saveButton = screen.getByText("Save Changes");
    fireEvent.click(saveButton);

    expect(mockUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        systemAudio: true,
      })
    );
  });
});
