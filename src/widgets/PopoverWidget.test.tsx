import { describe, test, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PopoverWidget } from "./PopoverWidget";

const mockClose = vi.fn();

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "request_audio_devices") return { devices: [] };
    return null;
  }),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    close: mockClose,
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
const mockGetProviderApiKey = vi.fn(async () => "");

vi.mock("@app/providers/SettingsProvider", () => ({
  useSettings: () => ({
    settings: mockSettings,
    updateSettings: mockUpdateSettings,
    getProviderApiKey: mockGetProviderApiKey,
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
    mockSettings.provider = "ollama";
    mockSettings.apiKey = "";
    mockUpdateSettings.mockReset();
    mockUpdateSettings.mockImplementation(async (updated: any) => {
      mockSettings = { ...mockSettings, ...updated };
    });
    mockGetProviderApiKey.mockReset();
    mockGetProviderApiKey.mockResolvedValue("");
    mockClose.mockReset();
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

  test("loads the destination provider credential when provider changes", async () => {
    mockGetProviderApiKey.mockResolvedValueOnce("anthropic-saved-key");
    render(<PopoverWidget />);

    fireEvent.click(screen.getByRole("button", { name: "AI Provider" }));
    fireEvent.change(screen.getAllByRole("combobox")[0], {
      target: { value: "anthropic" },
    });

    await waitFor(() => expect(mockGetProviderApiKey).toHaveBeenCalledWith("anthropic"));
    expect(screen.getByPlaceholderText("sk-...")).toHaveValue("anthropic-saved-key");

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "anthropic",
        apiKey: "anthropic-saved-key",
      }),
    ));
  });

  test("keeps edits open and reports a failed save", async () => {
    mockUpdateSettings.mockRejectedValueOnce(new Error("keychain unavailable"));
    render(<PopoverWidget />);

    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save changes");
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    expect(mockClose).not.toHaveBeenCalled();
  });

  test("does not close the settings window when focus moves away", () => {
    render(<PopoverWidget />);

    fireEvent.blur(window);

    expect(mockClose).not.toHaveBeenCalled();
  });
});
