export interface AudioDevice {
  id: number;
  name: string;
  type: "mic" | "loopback";
}

export type PythonEvent =
  | { event: "SYSTEM_READY"; data: { status: string } }
  | { event: "DEVICE_LIST"; data: { devices: AudioDevice[] } }
  | { event: "VAD_TELEMETRY"; data: { level: number } }
  | { event: "RECORDING_STATUS"; data: { is_recording: boolean } }
  | { event: "PIPELINE_STATUS"; data: { step: string } }
  | { event: "TRANSCRIPTION_COMPLETED"; data: { text: string; segments: any[] | null; diarized: boolean } }
  | { event: "NOTES_GENERATED"; data: { markdown: string; structured: any } }
  | { event: "ERROR"; data: { message: string } }
  | { event: "PREFLIGHT_RESULT"; data: any }
  | { event: "SIDECAR_DOWN"; data: null }
  | { event: "SIDECAR_RESTARTING"; data: { attempt: number } }
  | { event: "SIDECAR_UP"; data: null }
  | { event: "SIDECAR_FAILED"; data: null }
  | { event: "REPROCESS_COMPLETED"; data: { markdown: string; structured: any } };
