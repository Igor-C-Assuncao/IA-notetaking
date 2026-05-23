import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettings } from "@app/providers/SettingsProvider";
import { useTheme } from "@app/providers/ThemeProvider";
import { Toggle } from "@shared/ui/Toggle";
import { ShortcutsModal } from "@features/settings/ShortcutsModal";
import { usePythonEvent } from "@app/providers/IpcProvider";
import { AudioDevice } from "@shared/types/ipc-events";

export function PopoverWidget() {
  const { settings, updateSettings, loading } = useSettings();
  const { isLG } = useTheme();
  
  const [localSettings, setLocalSettings] = useState(settings);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [audioLevel, setAudioLevel] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [activeTab, setActiveTab] = useState<"audio" | "ai" | "behavior">("audio");
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [testCountdown, setTestCountdown] = useState(0);
  const win = getCurrentWindow();

  const [showNotionSettings, setShowNotionSettings] = useState(false);
  const [isValidatingNotion, setIsValidatingNotion] = useState(false);
  const [notionStatus, setNotionStatus] = useState("");

  usePythonEvent("NOTION_VALIDATED", (data) => {
    setIsValidatingNotion(false);
    if (data.success) {
      setNotionStatus(`✓ Connected to ${data.workspace_name}`);
    } else {
      setNotionStatus(`❌ ${data.error || "Validation failed"}`);
    }
  });

  const validateNotionConnection = async () => {
    if (!localSettings.notionToken || !localSettings.notionDatabaseId) {
      setNotionStatus("❌ Token and Database ID are required");
      return;
    }
    setIsValidatingNotion(true);
    setNotionStatus("Validating connection...");
    try {
      await invoke("send_command_to_python", {
        payload: JSON.stringify({
          action: "VALIDATE_NOTION",
          notion_token: localSettings.notionToken,
          notion_database_id: localSettings.notionDatabaseId,
        })
      });
    } catch (e) {
      setIsValidatingNotion(false);
      setNotionStatus(`❌ Error: ${String(e)}`);
    }
  };

  const startTest = async () => {
    if (isTestingMic) return;
    setIsTestingMic(true);
    setTestCountdown(5);
    try {
      await invoke("send_command_to_python", {
        payload: JSON.stringify({ action: "START_RECORDING", system_audio: false, is_test: true })
      });
      
      const interval = setInterval(() => {
        setTestCountdown(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      setTimeout(async () => {
        await invoke("send_command_to_python", {
          payload: JSON.stringify({ action: "STOP_RECORDING" })
        });
        setAudioLevel(0);
        setIsTestingMic(false);
      }, 5000);
    } catch (e) {
      console.error(e);
      setIsTestingMic(false);
    }
  };

  useEffect(() => {
    if (!loading) {
      setLocalSettings(settings);
    }
  }, [settings, loading]);

  useEffect(() => {
    invoke("request_audio_devices").catch(console.error);
  }, []);

  usePythonEvent("DEVICE_LIST", (data) => setDevices(data.devices || []));
  usePythonEvent("VAD_TELEMETRY", (data) => setAudioLevel(data.level || 0));

  useEffect(() => {
    let handler: (() => void) | null = null;
    const timer = setTimeout(() => {
      handler = () => win.close();
      window.addEventListener("blur", handler);
    }, 300);
    return () => {
      clearTimeout(timer);
      if (handler) window.removeEventListener("blur", handler);
    };
  }, [win]);

  const handleSave = async () => {
    await updateSettings(localSettings);
    await win.close();
  };

  const handleResetSetup = async () => {
    if (confirm("Are you sure you want to run the setup wizard again?")) {
      await updateSettings({ onboarding_completed: false });
      await win.close();
    }
  };

  const handleCopyWebPrompt = async () => {
    const promptText = `Please act as a Senior Principal Meeting Assistant. Below is a raw, real-time audio transcript from a meeting I just recorded. 

Your task is to analyze this transcript and generate a premium-grade executive summary formatted in rich GitHub-style markdown.

## Requirements:
1. **TL;DR**: A high-impact 2-sentence summary of the meeting's core purpose and outcome.
2. **Participants**: List all speakers and their key contributions or speaking patterns.
3. **Key Decisions**: A bulleted list of all critical decisions agreed upon during the discussion.
4. **Action Items**: A detailed checklist (with \`[ ]\` markdown checkboxes). Each action item MUST be concrete, actionable, and explicitly state who is responsible and what the deadline or constraint is. Include a short verbatim quote citation from the transcript in quotes for grounding (e.g., "[quote]").
5. **Numbers & Metrics**: Extract any quantitative figures, percentages, dates, budgets, or timelines mentioned.
6. **Tags**: Add a few relevant tag pills (e.g., #product-design, #budget, #sprint-planning).

---
### Meeting Raw Transcript:
[PASTE YOUR MEETING TRANSCRIPT HERE]`;

    try {
      await navigator.clipboard.writeText(promptText);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  if (loading) return null;

  return (
    <div className={`popover-window ${isLG ? "popover-lg" : "popover-nb"}`}>
      <div className="popover-drag-handle" data-tauri-drag-region />
      <div className="popover-header" data-tauri-drag-region>
        <span className="popover-title">Configuration</span>
        <button className="popover-close" onClick={() => win.close()}>✕</button>
      </div>

      <div className="popover-tabs">
        <button
          className={`popover-tab-btn ${activeTab === "audio" ? "active" : ""}`}
          onClick={() => setActiveTab("audio")}
        >
          Audio
        </button>
        <button
          className={`popover-tab-btn ${activeTab === "ai" ? "active" : ""}`}
          onClick={() => setActiveTab("ai")}
        >
          AI Provider
        </button>
        <button
          className={`popover-tab-btn ${activeTab === "behavior" ? "active" : ""}`}
          onClick={() => setActiveTab("behavior")}
        >
          Behavior
        </button>
      </div>

      <div className="popover-scroll-body">
        {activeTab === "audio" && (
          <div className="popover-tab-content">
            <div className="popover-section">
              <label className="popover-label">Audio Source</label>
              <select
                className="popover-select"
                value={localSettings.selectedDeviceId ?? ""}
                onChange={(e) => setLocalSettings({ ...localSettings, selectedDeviceId: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">System Default</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>

            <div className="popover-section">
              <label className="popover-label">Input Level</label>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <div className="popover-level-meter" style={{ flex: 1, marginBottom: 0 }}>
                  <div className="popover-level-bar" style={{ width: `${Math.min(100, audioLevel * 100)}%` }} />
                </div>
                <button 
                  className="popover-btn secondary" 
                  style={{ whiteSpace: "nowrap", padding: "4px 8px", fontSize: "11px", minHeight: "unset", height: "24px", marginTop: 0 }} 
                  onClick={startTest} 
                  disabled={isTestingMic}
                >
                  {isTestingMic ? `Testing... (${testCountdown}s)` : "Test Mic (5s)"}
                </button>
              </div>
            </div>

            <div className="popover-toggles-section">
              <div className="popover-toggle-row">
                <div className="popover-toggle-meta">
                  <span className="popover-toggle-label">System Audio (Loopback)</span>
                  <span className="popover-toggle-hint">Tap speaker output alongside microphone.</span>
                </div>
                <Toggle on={localSettings.systemAudio} onChange={(v) => setLocalSettings({ ...localSettings, systemAudio: v })} />
              </div>
            </div>
          </div>
        )}

        {activeTab === "ai" && (
          <div className="popover-tab-content">
            <div className="popover-section">
              <label className="popover-label">AI Provider</label>
              <select className="popover-select" value={localSettings.provider} onChange={(e) => setLocalSettings({ ...localSettings, provider: e.target.value })}>
                <option value="ollama">Ollama (Local)</option>
                <option value="openai">OpenAI</option>
                <option value="gemini">Google Gemini</option>
                <option value="anthropic">Anthropic Claude</option>
              </select>
            </div>

            <div className="popover-section">
              <label className="popover-label">Model Name</label>
              <input
                className="popover-input"
                value={localSettings.modelName}
                onChange={(e) => setLocalSettings({ ...localSettings, modelName: e.target.value })}
                placeholder="e.g. llama3, gpt-4o"
              />
            </div>

            {localSettings.provider !== "ollama" && (
              <div className="popover-section">
                <label className="popover-label">API Key</label>
                <input
                  type="password"
                  className="popover-input"
                  value={localSettings.apiKey || ""}
                  onChange={(e) => setLocalSettings({ ...localSettings, apiKey: e.target.value })}
                  placeholder="sk-..."
                />
              </div>
            )}

            <div className="popover-section prompt-helper-section">
              <span className="prompt-helper-text">Offline or key issue? Generate manual browser AI prompt:</span>
              <button className="popover-btn secondary prompt-helper-btn" onClick={handleCopyWebPrompt}>
                {copiedPrompt ? "✓ Copied Prompt!" : "Copy Web AI Prompt"}
              </button>
            </div>

            <div className="popover-section">
              <label className="popover-label">Custom System Prompt</label>
              <textarea
                className="popover-input"
                style={{ resize: "none", height: "80px", fontFamily: "inherit" }}
                value={localSettings.systemPrompt || ""}
                onChange={(e) => setLocalSettings({ ...localSettings, systemPrompt: e.target.value })}
                placeholder={"Examples:\n• Bullet points only\n• Focus on action items\n• Translate output to Portuguese"}
              />
            </div>
          </div>
        )}

        {activeTab === "behavior" && (
          <div className="popover-tab-content">
            <div className="popover-section">
              <label className="popover-label">UI Preferences</label>
              <select className="popover-select" value={localSettings.theme} onChange={(e) => setLocalSettings({ ...localSettings, theme: e.target.value })}>
                <option value="liquid-glass">Liquid Glass (Dark)</option>
                <option value="minimalist-notebook">Notebook Paper (Light)</option>
              </select>
            </div>

            <div className="popover-toggles-section">
              <div className="popover-toggle-row">
                <div className="popover-toggle-meta">
                  <span className="popover-toggle-label">Auto-Summarize</span>
                  <span className="popover-toggle-hint">Automatically compile summary when recording stops.</span>
                </div>
                <Toggle on={localSettings.autoSummarize} onChange={(v) => setLocalSettings({ ...localSettings, autoSummarize: v })} />
              </div>

              <div className="popover-toggle-row">
                <div className="popover-toggle-meta">
                  <span className="popover-toggle-label">Speaker Diarization</span>
                  <span className="popover-toggle-hint">Identify who spoke which words using Whispex / PyAnnote.</span>
                </div>
                <Toggle on={localSettings.speakerDiarization} onChange={(v) => setLocalSettings({ ...localSettings, speakerDiarization: v })} />
              </div>

              <div className="popover-toggle-row">
                <div className="popover-toggle-meta">
                  <span className="popover-toggle-label">Always on Top</span>
                  <span className="popover-toggle-hint">Keep widget overlay visible above other windows.</span>
                </div>
                <Toggle on={localSettings.alwaysOnTop} onChange={(v) => setLocalSettings({ ...localSettings, alwaysOnTop: v })} />
              </div>
            </div>

            <div className="popover-section" style={{ marginTop: "16px" }}>
              <label className="popover-label">Obsidian Vault Path</label>
              <input
                className="popover-input"
                value={localSettings.obsidianVaultPath || ""}
                onChange={(e) => setLocalSettings({ ...localSettings, obsidianVaultPath: e.target.value })}
                placeholder="e.g. C:\Users\Name\Documents\MyVault"
              />
            </div>

            <div className="popover-section" style={{ borderTop: "1px solid var(--border)", paddingTop: "12px", marginTop: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }} onClick={() => setShowNotionSettings(!showNotionSettings)}>
                <label className="popover-label" style={{ cursor: "pointer", margin: 0 }}>Notion Integration</label>
                <span style={{ fontSize: "11px", color: "var(--text-faint)" }}>{showNotionSettings ? "▼" : "▶"}</span>
              </div>
              
              {showNotionSettings && (
                <div style={{ marginTop: "10px", display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div>
                    <label className="popover-label" style={{ fontSize: "11px", opacity: 0.8 }}>Notion Token</label>
                    <input
                      type="password"
                      className="popover-input"
                      value={localSettings.notionToken || ""}
                      onChange={(e) => setLocalSettings({ ...localSettings, notionToken: e.target.value })}
                      placeholder="secret_..."
                    />
                  </div>
                  <div>
                    <label className="popover-label" style={{ fontSize: "11px", opacity: 0.8 }}>Database ID</label>
                    <input
                      className="popover-input"
                      value={localSettings.notionDatabaseId || ""}
                      onChange={(e) => setLocalSettings({ ...localSettings, notionDatabaseId: e.target.value })}
                      placeholder="32-character ID"
                    />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <button
                      className="popover-btn secondary"
                      style={{ height: "26px", minHeight: "unset", fontSize: "11px", padding: 0 }}
                      onClick={validateNotionConnection}
                      disabled={isValidatingNotion}
                    >
                      {isValidatingNotion ? "Validating..." : "Validate Connection"}
                    </button>
                    {notionStatus && (
                      <span style={{ fontSize: "11px", color: notionStatus.startsWith("✓") ? "#34c759" : "#ff3b30", textAlign: "center", fontWeight: 500 }}>
                        {notionStatus}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="popover-section danger-zone-section" style={{ marginTop: "24px", paddingTop: "12px", borderTop: "1px solid var(--border)" }}>
              <button className="popover-btn secondary danger-btn" style={{ width: "100%", color: "#ff5f57" }} onClick={handleResetSetup}>
                Restart Setup Wizard
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="popover-footer-bar">
        <button className="popover-btn secondary" onClick={() => setShowShortcuts(true)}>Shortcuts</button>
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
          <button className="popover-btn secondary" onClick={() => win.close()}>Cancel</button>
          <button className="popover-btn primary" onClick={handleSave}>Save Changes</button>
        </div>
      </div>

      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} isLG={isLG} />}
    </div>
  );
}
