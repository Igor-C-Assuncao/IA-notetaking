import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "@app/providers/SettingsProvider";
import { useTheme } from "@app/providers/ThemeProvider";
import { usePythonEvent } from "@app/providers/IpcProvider";

interface ReprocessModalProps {
  meetingId: number;
  originalTitle: string;
  originalDate: string;
  originalSummary: string;
  onClose: () => void;
  onSuccess: (newMarkdown: string) => void;
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
  const [errorMsg, setErrorMsg] = useState("");

  // Listen for pipeline status changes from the Python backend
  usePythonEvent("PIPELINE_STATUS", (data) => {
    if (isReprocessing) {
      setProgressStatus(data.step);
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
      setErrorMsg(data.message || "An unexpected LLM error occurred.");
    }
  });

  const handleRun = async () => {
    if (isReprocessing) return;
    setIsReprocessing(true);
    setErrorMsg("");
    setProgressStatus("Initializing reprocessing...");

    try {
      await invoke("reprocess_meeting", {
        meetingId,
        systemPrompt,
        provider,
        model,
        apiKey: provider === "ollama" ? "" : apiKey,
      });
    } catch (e) {
      console.error(e);
      setIsReprocessing(false);
      setErrorMsg(String(e) || "Failed to start reprocessing.");
    }
  };

  return (
    <div className={`modal-overlay ${isLG ? "modal-lg" : "modal-nb"}`}>
      <div className="modal-container" style={{ maxWidth: "580px", width: "90%" }}>
        <div className="modal-header">
          <div className="modal-title">Reprocess Summary</div>
          <button className="modal-close" onClick={onClose} disabled={isReprocessing}>✕</button>
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
              ⚠️ {errorMsg}
            </div>
          )}

          {/* reprocessing status indicator */}
          {isReprocessing && (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                <span>Processing...</span>
                <span style={{ fontWeight: 600 }}>{progressStatus}</span>
              </div>
              <div className="popover-level-meter" style={{ height: "4px", marginBottom: 0 }}>
                <div className="popover-level-bar animated-loading-bar" style={{ width: "100%" }} />
              </div>
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
