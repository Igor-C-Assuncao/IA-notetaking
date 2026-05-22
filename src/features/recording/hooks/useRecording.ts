import { useState, useEffect } from "react";
import { usePythonEvent } from "@app/providers/IpcProvider";
import { sendCommand } from "@shared/lib/ipc";

export function useRecording() {
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
    if (isRecording) {
      await sendCommand("stop_recording");
    } else {
      await sendCommand("start_recording");
    }
  };

  return { isRecording, recordingSeconds, audioLevel, status, toggleRecording };
}
