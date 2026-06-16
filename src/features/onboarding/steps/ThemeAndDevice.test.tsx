import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ThemeAndDevice } from "./ThemeAndDevice";
import { WizardState } from "../OnboardingWizard";
import { registerMockInvoke } from "../../../test/setup";

const handlers: Record<string, (data: any) => void> = {};

vi.mock("@app/providers/IpcProvider", () => ({
  usePythonEvent: (event: string, handler: (data: any) => void) => {
    handlers[event] = handler;
  },
}));

const state: WizardState = {
  providerType: "local",
  providerName: "ollama",
  model: "model",
  apiKey: "",
  hfToken: "",
  diarization: false,
  theme: "liquid-glass",
  selectedDeviceId: 9,
};

describe("ThemeAndDevice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerMockInvoke("request_audio_devices", vi.fn());
  });

  test("requests devices and uses the selected microphone for testing", async () => {
    render(
      <ThemeAndDevice
        state={state}
        setState={vi.fn()}
        onFinish={vi.fn()}
        onPrev={vi.fn()}
        isFinishing={false}
      />,
    );

    expect(invoke).toHaveBeenCalledWith("request_audio_devices");

    act(() => {
      handlers.DEVICE_LIST({
        devices: [
          { id: 9, name: "USB Microphone", type: "mic" },
          { id: 10, name: "System Loopback", type: "loopback" },
        ],
      });
    });

    expect(await screen.findByRole("option", { name: "USB Microphone" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "System Loopback" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Test Mic (5s)"));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("send_command_to_python", {
      payload: JSON.stringify({
        action: "START_RECORDING",
        system_audio: false,
        device_id: 9,
        is_test: true,
      }),
    }));
  });
});
