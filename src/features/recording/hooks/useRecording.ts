import { useState, useEffect } from "react";
import { usePythonEvent } from "@app/providers/IpcProvider";
import { useSettings } from "@app/providers/SettingsProvider";
import { invoke } from "@tauri-apps/api/core";

export function useRecording() {
  const { settings } = useSettings();
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [status, setStatus] = useState("Ready");

  usePythonEvent("RECORDING_STATUS", (data) => {
    setIsRecording(data.is_recording);
  });

  usePythonEvent("VAD_TELEMETRY", (data) => {
    setAudioLevel(data.level);
  });

  usePythonEvent("PIPELINE_STATUS", (data) => {
    setStatus(data.step);
  });

  useEffect(() => {
    if (!isRecording) {
      setRecordingSeconds(0);
      return;
    }
    const id = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [isRecording]);

  const toggleRecording = async () => {
    try {
      if (isRecording) {
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
          })
        });
      }
    } catch (e) {
      console.error("Failed to toggle recording:", e);
    }
  };

  return { isRecording, recordingSeconds, audioLevel, status, toggleRecording };
}
