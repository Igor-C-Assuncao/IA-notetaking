import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRecording } from "./useRecording";
import { invoke } from "@tauri-apps/api/core";

// Mock the settings provider
const mockSettings = {
  systemAudio: true,
  autoSummarize: true,
  speakerDiarization: false,
  language: "pt",
  systemPrompt: "My prompt",
  provider: "ollama",
  modelName: "llama3",
  apiKey: "sec_key",
  hf_token: "hf_tok",
};

vi.mock("@app/providers/SettingsProvider", () => ({
  useSettings: () => ({
    settings: mockSettings,
    loading: false,
  }),
}));

// Mock usePythonEvent event callbacks Map
let eventHandlers: Record<string, Function> = {};

vi.mock("@app/providers/IpcProvider", () => ({
  usePythonEvent: vi.fn((eventName: string, handler: Function) => {
    eventHandlers[eventName] = handler;
  }),
}));

describe("useRecording Hook", () => {
  beforeEach(() => {
    eventHandlers = {};
    vi.clearAllMocks();
  });

  test("initializes with correct defaults", () => {
    const { result } = renderHook(() => useRecording());
    
    expect(result.current.isRecording).toBe(false);
    expect(result.current.recordingSeconds).toBe(0);
    expect(result.current.audioLevel).toBe(0);
    expect(result.current.status).toBe("Ready");
  });

  test("reacts to Python RECORDING_STATUS events", () => {
    const { result } = renderHook(() => useRecording());
    
    expect(eventHandlers["RECORDING_STATUS"]).toBeDefined();
    
    act(() => {
      eventHandlers["RECORDING_STATUS"]({ is_recording: true });
    });
    
    expect(result.current.isRecording).toBe(true);
  });

  test("reacts to VAD_TELEMETRY events", () => {
    const { result } = renderHook(() => useRecording());
    
    expect(eventHandlers["VAD_TELEMETRY"]).toBeDefined();
    
    act(() => {
      eventHandlers["VAD_TELEMETRY"]({ level: 0.85 });
    });
    
    expect(result.current.audioLevel).toBe(0.85);
  });

  test("reacts to PIPELINE_STATUS events", () => {
    const { result } = renderHook(() => useRecording());
    
    expect(eventHandlers["PIPELINE_STATUS"]).toBeDefined();
    
    act(() => {
      eventHandlers["PIPELINE_STATUS"]({ step: "Transcribing with WhisperX..." });
    });
    
    expect(result.current.status).toBe("Transcribing with WhisperX...");
  });

  test("dispatches START_RECORDING command on toggle when idle", async () => {
    const { result } = renderHook(() => useRecording());
    
    await act(async () => {
      await result.current.toggleRecording();
    });

    expect(invoke).toHaveBeenCalledWith("send_command_to_python", {
      payload: JSON.stringify({
        action: "START_RECORDING",
        system_audio: true,
        auto_summarize: true,
        speaker_diarization: false,
        language: "pt",
        system_prompt: "My prompt",
        llm_provider: "ollama",
        llm_model: "llama3",
        api_key: "sec_key",
        hf_token: "hf_tok",
      }),
    });
  });

  test("dispatches STOP_RECORDING command on toggle when active", async () => {
    const { result } = renderHook(() => useRecording());
    
    // Simulate active recording
    act(() => {
      eventHandlers["RECORDING_STATUS"]({ is_recording: true });
    });
    expect(result.current.isRecording).toBe(true);

    await act(async () => {
      await result.current.toggleRecording();
    });

    expect(invoke).toHaveBeenCalledWith("send_command_to_python", {
      payload: JSON.stringify({ action: "STOP_RECORDING" }),
    });
  });
});
