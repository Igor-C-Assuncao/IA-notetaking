// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
export interface AudioDevice {
  id: number;
  name: string;
  type: "mic" | "loopback";
}

export type PythonEvent =
  | { event: "SYSTEM_READY"; data: { status: string } }
  | {
      event: "ENGINE_STATE";
      data: {
        phase: "process_ready" | "audio_ready" | "model_loading" | "transcription_ready" | "degraded" | "failed";
        recording: boolean;
        transcription: boolean;
        system_audio: boolean;
        message: string;
      };
    }
  | { event: "DEVICE_LIST"; data: { devices: AudioDevice[] } }
  | { event: "VAD_TELEMETRY"; data: { level: number; micLevel?: number; systemLevel?: number; activeSources?: Array<"mic" | "system"> } }
  | { event: "RECORDING_STATUS"; data: { is_recording: boolean } }
  | { event: "PIPELINE_STATUS"; data: { step: string } }
  | {
      event: "REPROCESS_STATUS";
      data: {
        meeting_id: number;
        stage:
          | "queued"
          | "preparing_context"
          | "estimating_tokens"
          | "calling_ai"
          | "processing_chunk"
          | "finalizing"
          | "completed"
          | "failed";
        message: string;
        progress?: number;
        elapsed_ms?: number;
        estimated_tokens?: number;
        chunk_current?: number;
        chunk_total?: number;
        token_status: "estimated" | "local_no_billing" | "actual_unavailable" | "unavailable";
        provider?: string;
        model?: string;
      };
    }
  | { event: "TRANSCRIPTION_COMPLETED"; data: { text: string; segments: TranscriptSegment[]; diarized: boolean; language?: string | null; warnings?: string[]; schema_version: number } }
  | { event: "TRANSCRIPTION_FAILED"; data: { code: string; message: string } }
  | { event: "NOTES_GENERATED"; data: { markdown: string; structured: StructuredSummary; raw_transcript?: string; transcript_segments?: TranscriptSegment[]; schema_version?: number } }
  | { event: "ERROR"; data: { message: string } }
  | { event: "PREFLIGHT_RESULT"; data: any }
  | { event: "SIDECAR_DOWN"; data: null }
  | { event: "SIDECAR_RESTARTING"; data: { attempt: number } }
  | { event: "SIDECAR_UP"; data: { readiness: "audio_ready" } }
  | { event: "SIDECAR_FAILED"; data: { cause: string; exitCode?: number | null; attempt: number } }
  | { event: "AI_RUNTIME_STATUS"; data: { state: "offline" | "ready" | "loading_model" | "generating" | "completed" | "failed"; provider: string; model: string; elapsed_ms: number; message: string } }
  | { event: "DIAGNOSTIC_EVENT"; data: { code: string; level: "info" | "warning" | "error"; message: string; component?: string; attempt?: number } }
  | { event: "sidecar-starting"; data: { kind: "cpu" | "gpu" } }
  | { event: "engine-download-progress"; data: { kind: "cpu" | "gpu"; stage: string; currentPart?: number; totalParts?: number; attempt?: number; downloadedBytes: number; totalBytes?: number | null; speedBytesPerSecond?: number | null; etaSeconds?: number | null; message: string; sha256?: string } }
  | { event: "engine-download-completed"; data: { kind: "cpu" | "gpu"; path: string; sha256: string; sizeBytes: number } }
  | { event: "ollama-install-progress"; data: { stage: string; message: string } }
  | { event: "REPROCESS_COMPLETED"; data: { meeting_id: number; markdown: string; structured: any } }
  | { event: "FOLLOWUP_GENERATED"; data: { meeting_id: number | null; email_draft: EmailDraft } }
  | { event: "CONTINUITY_GENERATED"; data: { meeting_id: number | null; continuity: ContinuityReport } }
  | { event: "NOTION_EXPORT_COMPLETED"; data: { success: boolean; page_id?: string; error?: string } }
  | { event: "NOTION_VALIDATED"; data: { success: boolean; workspace_name?: string; error?: string } }
  | { event: "BACKFILL_STATUS"; data: { progress: number; current: number; total: number; message: string } }
  | { event: "BACKFILL_COMPLETED"; data: { success: boolean; count?: number; error?: string } }
  | { event: "COPILOT_STREAM"; data: { chunk: string } }
  | { event: "COPILOT_COMPLETED"; data: { success: boolean; answer?: string; error?: string } };
import type { ContinuityReport, EmailDraft, StructuredSummary, TranscriptSegment } from "@features/summary/types";
