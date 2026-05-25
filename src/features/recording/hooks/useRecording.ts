import { useState, useEffect } from "react";
import { usePythonEvent } from "@app/providers/IpcProvider";
import { useSettings } from "@app/providers/SettingsProvider";
import { invoke } from "@tauri-apps/api/core";

// Global state variables
let globalIsRecording = false;
let globalRecordingSeconds = 0;
let globalAudioLevel = 0;
let globalStatus = "Ready";

const recordingListeners = new Set<() => void>();

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
  globalStatus = "Ready";
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
  const [status, setStatusState] = useState(globalStatus);

  useEffect(() => {
    const handleChange = () => {
      setIsRecordingState(globalIsRecording);
      setRecordingSecondsState(globalRecordingSeconds);
      setAudioLevelState(globalAudioLevel);
      setStatusState(globalStatus);
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
    globalAudioLevel = data.level;
    emitRecordingChange();
  });

  usePythonEvent("PIPELINE_STATUS", (data) => {
    globalStatus = data.step;
    emitRecordingChange();
  });

  const toggleRecording = async () => {
    try {
      if (globalIsRecording) {
        await invoke("send_command_to_python", {
          payload: JSON.stringify({ action: "STOP_RECORDING" })
        });
      } else {
        await invoke("send_command_to_python", {
          payload: JSON.stringify({
            action: "START_RECORDING",
            system_audio: settings.systemAudio,
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

  return { isRecording, recordingSeconds, audioLevel, status, toggleRecording };
}
