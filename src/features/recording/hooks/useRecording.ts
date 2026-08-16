// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { useState, useEffect } from "react";
import { usePythonEvent } from "@app/providers/IpcProvider";
import { useSettings } from "@app/providers/SettingsProvider";
import { invoke } from "@tauri-apps/api/core";

// Global state variables
let globalIsRecording = false;
let globalRecordingSeconds = 0;
let globalAudioLevel = 0;
let globalMicLevel = 0;
let globalSystemLevel = 0;
let globalStatus = "Ready";
let globalTranscriptionReady = false;

const recordingListeners = new Set<() => void>();

export type AudioInputState = "none" | "low" | "ok";

export function getAudioInputState(audioLevel: number): {
  state: AudioInputState;
  label: string;
} {
  if (audioLevel < 0.01) return { state: "none", label: "No input detected" };
  if (audioLevel < 0.04) return { state: "low", label: "Low input" };
  return { state: "ok", label: "Input detected" };
}

function emitRecordingChange() {
  recordingListeners.forEach((l) => l());
}

let globalTimerInterval: any = null;

function startGlobalTimer() {
  if (globalTimerInterval) return;
  globalTimerInterval = setInterval(() => {
    globalRecordingSeconds += 1;
    emitRecordingChange();
  }, 1000);
}

function stopGlobalTimer() {
  if (globalTimerInterval) {
    clearInterval(globalTimerInterval);
    globalTimerInterval = null;
  }
  globalRecordingSeconds = 0;
  emitRecordingChange();
}

function setGlobalIsRecording(recording: boolean) {
  if (globalIsRecording === recording) return;
  globalIsRecording = recording;
  if (recording) {
    startGlobalTimer();
  } else {
    stopGlobalTimer();
  }
  emitRecordingChange();
}

export function resetGlobalRecordingState() {
  globalIsRecording = false;
  globalRecordingSeconds = 0;
  globalAudioLevel = 0;
  globalMicLevel = 0;
  globalSystemLevel = 0;
  globalStatus = "Ready";
  globalTranscriptionReady = false;
  if (globalTimerInterval) {
    clearInterval(globalTimerInterval);
    globalTimerInterval = null;
  }
  recordingListeners.clear();
}

export function useRecording() {
  const { settings } = useSettings();
  const [isRecording, setIsRecordingState] = useState(globalIsRecording);
  const [recordingSeconds, setRecordingSecondsState] = useState(globalRecordingSeconds);
  const [audioLevel, setAudioLevelState] = useState(globalAudioLevel);
  const [micLevel, setMicLevelState] = useState(globalMicLevel);
  const [systemLevel, setSystemLevelState] = useState(globalSystemLevel);
  const [status, setStatusState] = useState(globalStatus);
  const [transcriptionReady, setTranscriptionReady] = useState(globalTranscriptionReady);

  useEffect(() => {
    const handleChange = () => {
      setIsRecordingState(globalIsRecording);
      setRecordingSecondsState(globalRecordingSeconds);
      setAudioLevelState(globalAudioLevel);
      setMicLevelState(globalMicLevel);
      setSystemLevelState(globalSystemLevel);
      setStatusState(globalStatus);
      setTranscriptionReady(globalTranscriptionReady);
    };
    recordingListeners.add(handleChange);
    return () => {
      recordingListeners.delete(handleChange);
    };
  }, []);

  usePythonEvent("RECORDING_STATUS", (data) => {
    setGlobalIsRecording(data.is_recording);
  });

  usePythonEvent("VAD_TELEMETRY", (data) => {
    const nextLevel = data.level || Math.max(data.micLevel || 0, data.systemLevel || 0);
    globalAudioLevel = nextLevel;
    globalMicLevel = data.micLevel ?? nextLevel;
    globalSystemLevel = data.systemLevel ?? 0;
    emitRecordingChange();
  });

  usePythonEvent("PIPELINE_STATUS", (data) => {
    globalStatus = data.step;
    emitRecordingChange();
  });

  usePythonEvent("ENGINE_STATE", (data) => {
    globalStatus = data.message || data.phase;
    globalTranscriptionReady = data.phase === "transcription_ready";
    emitRecordingChange();
  });

  usePythonEvent("TRANSCRIPTION_FAILED", (data) => {
    if (data.code === "AUDIO_TOO_QUIET") {
      globalStatus = "Transcription failed: audio was too quiet. Select the correct microphone or turn on System Audio.";
    } else {
      globalStatus = `Transcription failed: ${data.message}`;
    }
    emitRecordingChange();
  });

  const toggleRecording = async () => {
    try {
      if (globalIsRecording) {
        await invoke("send_command_to_python", {
          payload: JSON.stringify({ action: "STOP_RECORDING" })
        });
      } else {
        if (!globalTranscriptionReady) {
          globalStatus = "Transcription is still loading. Recording will unlock when Whisper is ready.";
          emitRecordingChange();
          return;
        }
        await invoke("send_command_to_python", {
          payload: JSON.stringify({
            action: "START_RECORDING",
            system_audio: settings.systemAudio,
            device_id: settings.selectedDeviceId,
            auto_summarize: settings.autoSummarize,
            speaker_diarization: settings.speakerDiarization,
            language: settings.language || "auto",
            system_prompt: settings.systemPrompt || "",
            llm_provider: settings.provider,
            llm_model: settings.modelName,
            api_key: settings.apiKey || "",
            hf_token: settings.hf_token || "",
          })
        });
      }
    } catch (e) {
      console.error("Failed to toggle recording:", e);
    }
  };

  const inputState = getAudioInputState(audioLevel);

  return { isRecording, recordingSeconds, audioLevel, micLevel, systemLevel, inputState, status, transcriptionReady, toggleRecording };
}
