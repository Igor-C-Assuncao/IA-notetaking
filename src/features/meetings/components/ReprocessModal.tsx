// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "@app/providers/SettingsProvider";
import { useTheme } from "@app/providers/ThemeProvider";
import { usePythonEvent } from "@app/providers/IpcProvider";
import type { PythonEvent } from "@shared/types/ipc-events";

interface ReprocessModalProps {
  meetingId: number;
  originalTitle: string;
  originalDate: string;
  originalSummary: string;
  onClose: () => void;
  onSuccess: (newMarkdown: string) => void;
}

type ReprocessStatus = Extract<PythonEvent, { event: "REPROCESS_STATUS" }>["data"];
type LogEntry = { elapsedMs: number; message: string; stage: ReprocessStatus["stage"] | "error" };

function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatStage(stage?: ReprocessStatus["stage"]) {
  if (!stage) return "Waiting";
  return stage
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
    .replace(/\bAi\b/g, "AI");
}

function normalizeProgress(progress?: number) {
  if (typeof progress !== "number" || Number.isNaN(progress)) return null;
  const normalized = progress > 1 ? progress / 100 : progress;
  return Math.min(1, Math.max(0, normalized));
}

function tokenMessage(status: ReprocessStatus | null, fallbackProvider: string) {
  const provider = (status?.provider || fallbackProvider || "").toLowerCase();
  if (status?.token_status === "local_no_billing" || provider === "ollama") {
    return "No API token billing; local model processing.";
  }
  if (status?.token_status === "actual_unavailable") {
    return "Actual token usage not reported by provider.";
  }
  if (status?.estimated_tokens) {
    return `Estimated input: ~${new Intl.NumberFormat("en-US").format(Math.round(status.estimated_tokens))} tokens.`;
  }
  return "Estimated input tokens will appear after context preparation.";
}

export function ReprocessModal({
  meetingId,
  originalTitle,
  originalDate,
  onClose,
  onSuccess,
}: ReprocessModalProps) {
  const { settings } = useSettings();
  const { isLG } = useTheme();

  // Local state pre-filled with settings defaults
  const [systemPrompt, setSystemPrompt] = useState(settings.systemPrompt || "");
  const [provider, setProvider] = useState(settings.provider || "ollama");
  const [model, setModel] = useState(settings.modelName || "llama3");
  const [apiKey, setApiKey] = useState(settings.apiKey || "");
  
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [progressStatus, setProgressStatus] = useState("");
  const [reprocessStatus, setReprocessStatus] = useState<ReprocessStatus | null>(null);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedNow, setElapsedNow] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    if (!isReprocessing || startedAt === null) return;
    const interval = window.setInterval(() => {
      setElapsedNow(Date.now() - startedAt);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isReprocessing, startedAt]);

  const elapsedMs = reprocessStatus?.elapsed_ms ?? elapsedNow;
  const progress = normalizeProgress(reprocessStatus?.progress);
  const progressPercent = progress === null ? null : Math.round(progress * 100);
  const aiInProgress = reprocessStatus
    ? ["calling_ai", "processing_chunk", "finalizing"].includes(reprocessStatus.stage)
    : false;
  const visibleLogEntries = useMemo(() => logEntries.slice(-8), [logEntries]);

  // Keep the old pipeline status as a fallback for older sidecars.
  usePythonEvent("PIPELINE_STATUS", (data) => {
    if (isReprocessing && !reprocessStatus) {
      setProgressStatus(data.step);
    }
  });

  usePythonEvent("REPROCESS_STATUS", (data) => {
    if (data.meeting_id !== meetingId) return;
    setReprocessStatus(data);
    setProgressStatus(data.message);
    setLogEntries((current) => [
      ...current,
      { elapsedMs: data.elapsed_ms ?? 0, message: data.message, stage: data.stage },
    ].slice(-8));
    if (data.stage === "failed") {
      setIsReprocessing(false);
      setErrorMsg(data.message);
    }
  });

  // Listen for completion
  usePythonEvent("REPROCESS_COMPLETED", (data) => {
    if (isReprocessing && data.meeting_id === meetingId) {
      setIsReprocessing(false);
      onSuccess(data.markdown);
      onClose();
    }
  });

  // Listen for generic backend errors
  usePythonEvent("ERROR", (data) => {
    if (isReprocessing) {
      setIsReprocessing(false);
      const message = data.message || "An unexpected LLM error occurred.";
      setErrorMsg(message);
      setLogEntries((current) => [
        ...current,
        { elapsedMs, message, stage: "error" as const },
      ].slice(-8));
    }
  });

  const handleRun = async () => {
    if (isReprocessing) return;
    const now = Date.now();
    setIsReprocessing(true);
    setStartedAt(now);
    setElapsedNow(0);
    setErrorMsg("");
    setProgressStatus("Initializing reprocessing...");
    setReprocessStatus({
      meeting_id: meetingId,
      stage: "queued",
      message: "Initializing reprocessing...",
      progress: 0.02,
      elapsed_ms: 0,
      token_status: provider === "ollama" ? "local_no_billing" : "estimated",
      provider,
      model,
    });
    setLogEntries([{ elapsedMs: 0, message: "Initializing reprocessing...", stage: "queued" }]);

    try {
      await invoke("reprocess_meeting", {
        meetingId,
        systemPrompt,
        provider,
        model,
        apiKey: provider === "ollama" ? "" : apiKey,
      });
    } catch (e) {
      const message = String(e) || "Failed to start reprocessing.";
      console.error(e);
      setIsReprocessing(false);
      setErrorMsg(message);
      setReprocessStatus((current) => current ? { ...current, stage: "failed", message } : current);
      setLogEntries((current) => [
        ...current,
        { elapsedMs: Date.now() - now, message, stage: "error" as const },
      ].slice(-8));
    }
  };

  return (
    <div className={`modal-overlay ${isLG ? "modal-lg" : "modal-nb"}`}>
      <div className="modal-container" style={{ maxWidth: "620px", width: "90%" }}>
        <div className="modal-header">
          <div className="modal-title">Reprocess Summary</div>
          <button className="modal-close" onClick={onClose} disabled={isReprocessing}>x</button>
        </div>

        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          
          {/* original context header */}
          <div className="original-context-banner">
            <span style={{ fontWeight: 600 }}>Original:</span> {originalTitle} ({originalDate})
          </div>

          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            
            {/* prompt editor - left */}
            <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <label className="popover-label">System Prompt Override</label>
              <textarea
                className="popover-input"
                style={{ resize: "none", height: "180px", fontFamily: "inherit", fontSize: "12px", lineHeight: "1.5" }}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="Instruct the AI on how to format or translate this specific summary..."
                disabled={isReprocessing}
              />
            </div>

            {/* settings panel - right */}
            <div style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div className="popover-section" style={{ margin: 0 }}>
                <label className="popover-label">AI Provider</label>
                <select
                  className="popover-select"
                  value={provider}
                  onChange={(e) => {
                    setProvider(e.target.value);
                    if (e.target.value === "ollama") setModel("llama3");
                    else if (e.target.value === "openai") setModel("gpt-4o");
                    else if (e.target.value === "gemini") setModel("gemini-2.5-flash");
                    else if (e.target.value === "anthropic") setModel("claude-3-haiku-20240307");
                  }}
                  disabled={isReprocessing}
                >
                  <option value="ollama">Ollama (Local)</option>
                  <option value="openai">OpenAI</option>
                  <option value="gemini">Google Gemini</option>
                  <option value="anthropic">Anthropic Claude</option>
                </select>
              </div>

              <div className="popover-section" style={{ margin: 0 }}>
                <label className="popover-label">Model Name</label>
                <input
                  className="popover-input"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. llama3, gpt-4o"
                  disabled={isReprocessing}
                />
              </div>

              {provider !== "ollama" && (
                <div className="popover-section" style={{ margin: 0 }}>
                  <label className="popover-label">API Key Override</label>
                  <input
                    type="password"
                    className="popover-input"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={settings.apiKey ? "••••••••••••••••" : "sk-..."}
                    disabled={isReprocessing}
                  />
                </div>
              )}
            </div>

          </div>

          {/* error display */}
          {errorMsg && (
            <div className="modal-error-box" style={{ color: "#ff3b30", fontSize: "12px", background: "rgba(255,59,48,0.1)", padding: "8px 12px", borderRadius: "6px" }}>
              Warning: {errorMsg}
            </div>
          )}

          {(isReprocessing || reprocessStatus || logEntries.length > 0) && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "4px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", fontSize: "12px" }}>
                <span style={{ fontWeight: 600 }}>Progress</span>
                <span>{formatElapsed(elapsedMs)}</span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px", fontSize: "12px" }}>
                <div>
                  <div className="popover-label">Current stage</div>
                  <div style={{ fontWeight: 600 }}>{formatStage(reprocessStatus?.stage)}</div>
                </div>
                <div>
                  <div className="popover-label">Provider / model</div>
                  <div style={{ fontWeight: 600 }}>{reprocessStatus?.provider || provider} / {reprocessStatus?.model || model}</div>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <div className="popover-label">Token status</div>
                  <div>{tokenMessage(reprocessStatus, provider)}</div>
                  {aiInProgress && provider !== "ollama" && (
                    <div style={{ marginTop: "4px", color: "var(--text-secondary)" }}>
                      AI request in progress; tokens may be consumed by provider.
                    </div>
                  )}
                </div>
                {reprocessStatus?.chunk_total && (
                  <div style={{ gridColumn: "1 / -1" }}>
                    Chunk {reprocessStatus.chunk_current || 0} of {reprocessStatus.chunk_total}
                  </div>
                )}
              </div>

              <div className="popover-level-meter" style={{ height: "5px", marginBottom: 0 }}>
                <div
                  className={`popover-level-bar ${progress === null ? "animated-loading-bar" : ""}`}
                  style={{ width: progressPercent === null ? "100%" : `${progressPercent}%` }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: "var(--text-secondary)" }}>
                <span>{progressStatus || reprocessStatus?.message || "Waiting for backend status..."}</span>
                {progressPercent !== null && <span>{progressPercent}%</span>}
              </div>

              {visibleLogEntries.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "12px", background: "rgba(127,127,127,0.08)", border: "1px solid var(--border)", borderRadius: "6px", padding: "8px" }}>
                  {visibleLogEntries.map((entry, index) => (
                    <div key={`${entry.stage}-${entry.elapsedMs}-${index}`} style={{ display: "grid", gridTemplateColumns: "42px 1fr", gap: "8px" }}>
                      <span style={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>{formatElapsed(entry.elapsedMs)}</span>
                      <span>{entry.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

        <div className="modal-footer" style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "16px", borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
          <button
            className="popover-btn secondary"
            onClick={onClose}
            disabled={isReprocessing}
            style={{ minHeight: "32px", height: "32px", padding: "0 14px", fontSize: "12px" }}
          >
            Cancel
          </button>
          <button
            className="popover-btn primary"
            onClick={handleRun}
            disabled={isReprocessing}
            style={{ minHeight: "32px", height: "32px", padding: "0 14px", fontSize: "12px" }}
          >
            {isReprocessing ? "Reprocessing..." : "Run Reprocess"}
          </button>
        </div>
      </div>
    </div>
  );
}