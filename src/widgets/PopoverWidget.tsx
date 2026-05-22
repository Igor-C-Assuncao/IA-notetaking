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
  const win = getCurrentWindow();

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
      // We can't do window.location.reload() safely here because this is the popover window.
      // We need to tell the main window to reload, or just close the popover.
      // Actually, since settings are shared, changing it will trigger a re-render on main window.
      await win.close();
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

      <div className="popover-scroll-body">
        
        <div className="popover-section">
          <label className="popover-label">Theme</label>
          <select className="popover-select" value={localSettings.theme} onChange={(e) => setLocalSettings({ ...localSettings, theme: e.target.value })}>
            <option value="liquid-glass">Liquid Glass (Dark)</option>
            <option value="minimalist-notebook">Notebook Paper (Light)</option>
          </select>
        </div>

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
          <div className="vu-meter">
            <div className="vu-bar" style={{ width: `${Math.min(100, audioLevel * 100)}%` }} />
          </div>
        </div>

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
            className="popover-input custom-model-input"
            value={localSettings.modelName}
            onChange={(e) => setLocalSettings({ ...localSettings, modelName: e.target.value })}
            placeholder="e.g. gemma4:e2b"
          />
        </div>

        {localSettings.provider !== "ollama" && (
          <div className="popover-section">
            <label className="popover-label">API Key</label>
            <input
              type="password"
              className="popover-input custom-model-input"
              value={localSettings.apiKey}
              onChange={(e) => setLocalSettings({ ...localSettings, apiKey: e.target.value })}
              placeholder="sk-..."
            />
          </div>
        )}

        <div className="popover-section">
          <label className="popover-label">System Prompt (Optional)</label>
          <textarea
            className="popover-input custom-model-input"
            style={{ resize: "none", height: "80px", fontFamily: "inherit" }}
            value={localSettings.systemPrompt}
            onChange={(e) => setLocalSettings({ ...localSettings, systemPrompt: e.target.value })}
            placeholder="Guides the AI output style..."
          />
        </div>

        <div className="popover-section toggle-group">
          <div className="toggle-row">
            <span className="toggle-label">System Audio (Loopback)</span>
            <Toggle on={localSettings.systemAudio} onChange={(v) => setLocalSettings({ ...localSettings, systemAudio: v })} />
          </div>
          <div className="toggle-row">
            <span className="toggle-label">Auto-Summarize</span>
            <Toggle on={localSettings.autoSummarize} onChange={(v) => setLocalSettings({ ...localSettings, autoSummarize: v })} />
          </div>
          <div className="toggle-row">
            <span className="toggle-label">Speaker Diarization</span>
            <Toggle on={localSettings.speakerDiarization} onChange={(v) => setLocalSettings({ ...localSettings, speakerDiarization: v })} />
          </div>
          <div className="toggle-row">
            <span className="toggle-label">Always on Top</span>
            <Toggle on={localSettings.alwaysOnTop} onChange={(v) => setLocalSettings({ ...localSettings, alwaysOnTop: v })} />
          </div>
        </div>

        <div className="popover-section">
          <button className="link-btn" style={{ color: "#ff5f57", padding: "10px 0" }} onClick={handleResetSetup}>
            Restart Setup Wizard
          </button>
        </div>

      </div>

      <div className="popover-footer-bar">
        <button className="link-btn" onClick={() => setShowShortcuts(true)}>Shortcuts</button>
        <button className="btn-save-sm" style={{ marginLeft: "auto" }} onClick={handleSave}>Save</button>
      </div>

      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} isLG={isLG} />}
    </div>
  );
}
