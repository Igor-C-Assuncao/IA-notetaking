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
  | { event: "TRANSCRIPTION_COMPLETED"; data: { text: string; segments: TranscriptSegment[]; diarized: boolean; warnings?: string[]; schema_version: number } }
  | { event: "TRANSCRIPTION_FAILED"; data: { code: string; message: string } }
  | { event: "NOTES_GENERATED"; data: { markdown: string; structured: StructuredSummary; raw_transcript?: string; transcript_segments?: TranscriptSegment[]; schema_version?: number } }
  | { event: "ERROR"; data: { message: string } }
  | { event: "PREFLIGHT_RESULT"; data: any }
  | { event: "SIDECAR_DOWN"; data: null }
  | { event: "SIDECAR_RESTARTING"; data: { attempt: number } }
  | { event: "SIDECAR_UP"; data: null }
  | { event: "SIDECAR_FAILED"; data: null }
  | { event: "REPROCESS_COMPLETED"; data: { meeting_id: number; markdown: string; structured: any } }
  | { event: "NOTION_EXPORT_COMPLETED"; data: { success: boolean; page_id?: string; error?: string } }
  | { event: "NOTION_VALIDATED"; data: { success: boolean; workspace_name?: string; error?: string } }
  | { event: "BACKFILL_STATUS"; data: { progress: number; current: number; total: number; message: string } }
  | { event: "BACKFILL_COMPLETED"; data: { success: boolean; count?: number; error?: string } }
  | { event: "COPILOT_STREAM"; data: { chunk: string } }
  | { event: "COPILOT_COMPLETED"; data: { success: boolean; answer?: string; error?: string } };
import type { StructuredSummary, TranscriptSegment } from "@features/summary/types";
