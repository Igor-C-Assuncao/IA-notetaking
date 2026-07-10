// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRecording, resetGlobalRecordingState, getAudioInputState } from "./useRecording";
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
  selectedDeviceId: 7,
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
    resetGlobalRecordingState();
  });

  test("initializes with correct defaults", () => {
    const { result } = renderHook(() => useRecording());
    
    expect(result.current.isRecording).toBe(false);
    expect(result.current.recordingSeconds).toBe(0);
    expect(result.current.audioLevel).toBe(0);
    expect(result.current.micLevel).toBe(0);
    expect(result.current.systemLevel).toBe(0);
    expect(result.current.inputState).toEqual({ state: "none", label: "No input detected" });
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
    expect(result.current.micLevel).toBe(0.85);
    expect(result.current.systemLevel).toBe(0);
    expect(result.current.inputState).toEqual({ state: "ok", label: "Input detected" });
  });

  test("tracks microphone and system telemetry separately", () => {
    const { result } = renderHook(() => useRecording());

    act(() => {
      eventHandlers["VAD_TELEMETRY"]({ level: 0.42, micLevel: 0.08, systemLevel: 0.42, activeSources: ["mic", "system"] });
    });

    expect(result.current.audioLevel).toBe(0.42);
    expect(result.current.micLevel).toBe(0.08);
    expect(result.current.systemLevel).toBe(0.42);
  });

  test("derives audio input states from telemetry levels", () => {
    expect(getAudioInputState(0)).toEqual({ state: "none", label: "No input detected" });
    expect(getAudioInputState(0.02)).toEqual({ state: "low", label: "Low input" });
    expect(getAudioInputState(0.04)).toEqual({ state: "ok", label: "Input detected" });
  });

  test("reacts to PIPELINE_STATUS events", () => {
    const { result } = renderHook(() => useRecording());
    
    expect(eventHandlers["PIPELINE_STATUS"]).toBeDefined();
    
    act(() => {
      eventHandlers["PIPELINE_STATUS"]({ step: "Transcribing with WhisperX..." });
    });
    
    expect(result.current.status).toBe("Transcribing with WhisperX...");
  });

  test("surfaces structured transcription failures", () => {
    const { result } = renderHook(() => useRecording());

    expect(eventHandlers["TRANSCRIPTION_FAILED"]).toBeDefined();

    act(() => {
      eventHandlers["TRANSCRIPTION_FAILED"]({
        code: "AUDIO_FILE_EMPTY",
        message: "Recording was too short.",
      });
    });

    expect(result.current.status).toBe("Transcription failed: Recording was too short.");
  });

  test("surfaces actionable audio-too-quiet failures", () => {
    const { result } = renderHook(() => useRecording());

    act(() => {
      eventHandlers["TRANSCRIPTION_FAILED"]({
        code: "AUDIO_TOO_QUIET",
        message: "Audio too quiet.",
      });
    });

    expect(result.current.status).toBe("Transcription failed: audio was too quiet. Select the correct microphone or turn on System Audio.");
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
        device_id: 7,
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
