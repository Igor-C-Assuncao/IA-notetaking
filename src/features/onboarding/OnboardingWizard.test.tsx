// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { OnboardingWizard } from "./OnboardingWizard";
import { registerMockInvoke } from "../../test/setup";
import { WindowModeProvider } from "@features/window-chrome/WindowModeProvider";

const updateSettings = vi.fn();

vi.mock("@app/providers/SettingsProvider", () => ({
  useSettings: () => ({
    settings: { theme: "liquid-glass", selectedDeviceId: null },
    updateSettings,
  }),
}));

vi.mock("./steps/ProviderSelection", () => ({
  ProviderSelection: ({ setState, onNext }: any) => (
    <button onClick={() => {
      setState((state: any) => ({
        ...state,
        providerType: "cloud",
        providerName: "openai",
        model: "gpt-test",
        apiKey: "new-cloud-key",
      }));
      onNext();
    }}>Provider Next</button>
  ),
}));

vi.mock("./steps/CloudValidation", () => ({
  CloudValidation: ({ onNext }: any) => <button onClick={onNext}>Cloud Next</button>,
}));

vi.mock("./steps/HuggingFaceSetup", () => ({
  HuggingFaceSetup: ({ setState, onNext }: any) => (
    <button onClick={() => {
      setState((state: any) => ({
        ...state,
        hfToken: "hf-new-token",
        diarization: true,
      }));
      onNext();
    }}>HF Next</button>
  ),
}));

vi.mock("./steps/ThemeAndDevice", () => ({
  ThemeAndDevice: ({ setState, onFinish }: any) => (
    <>
      <button onClick={() => setState((state: any) => ({ ...state, selectedDeviceId: 4 }))}>
        Select Device
      </button>
      <button onClick={onFinish}>Finish Setup</button>
    </>
  ),
}));

describe("OnboardingWizard", () => {
  beforeEach(() => {
    updateSettings.mockReset();
    updateSettings.mockResolvedValue(undefined);
    registerMockInvoke("set_wizard_mode", vi.fn());
    registerMockInvoke("set_compact_mode", vi.fn());
  });

  test("persists cloud key, Hugging Face token, and selected microphone", async () => {
    render(<WindowModeProvider><OnboardingWizard /></WindowModeProvider>);

    fireEvent.click(screen.getByText("Provider Next"));
    fireEvent.click(screen.getByText("Cloud Next"));
    fireEvent.click(screen.getByText("HF Next"));
    fireEvent.click(screen.getByText("Select Device"));
    fireEvent.click(screen.getByText("Finish Setup"));

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai",
      modelName: "gpt-test",
      apiKey: "new-cloud-key",
      hf_token: "hf-new-token",
      speakerDiarization: true,
      selectedDeviceId: 4,
      onboarding_completed: true,
    })));
  });
});
