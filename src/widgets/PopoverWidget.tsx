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
    const effectiveModel = localSettings.customModel.trim() || localSettings.modelName;
    await updateSettings({ ...localSettings, modelName: effectiveModel });
    await win.close();
  };

  if (loading) return null;

  return (
    <div className={`popover-window ${isLG ? "popover-lg" : "popover-nb"}`}>
      <div className="popover-header">
        <span className="popover-title">Configuration</span>
        <button className="popover-close" onClick={() => win.close()}>✕</button>
      </div>

      <div className="popover-content">
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
          <label className="popover-label">Model Selection</label>
          <div className="popover-grid-2">
            <button className={`model-btn ${localSettings.modelName === "llama3" ? "active" : ""}`} onClick={() => setLocalSettings({ ...localSettings, modelName: "llama3" })}>
              <span className="model-name">Llama 3</span>
              <span className="model-desc">Fast, local</span>
            </button>
            <button className={`model-btn ${localSettings.modelName === "phi3" ? "active" : ""}`} onClick={() => setLocalSettings({ ...localSettings, modelName: "phi3" })}>
              <span className="model-name">Phi-3</span>
              <span className="model-desc">Ultra-light</span>
            </button>
            <button className={`model-btn ${localSettings.modelName === "mistral" ? "active" : ""}`} onClick={() => setLocalSettings({ ...localSettings, modelName: "mistral" })}>
              <span className="model-name">Mistral</span>
              <span className="model-desc">Balanced</span>
            </button>
            <button className={`model-btn ${!["llama3", "phi3", "mistral"].includes(localSettings.modelName) ? "active" : ""}`} onClick={() => document.getElementById("custom-model-input")?.focus()}>
              <span className="model-name">Custom</span>
              <span className="model-desc">Other local</span>
            </button>
          </div>
          <input
            id="custom-model-input"
            className="popover-input custom-model-input"
            placeholder="e.g. gemma:7b"
            value={localSettings.customModel}
            onChange={(e) => setLocalSettings({ ...localSettings, customModel: e.target.value })}
            onFocus={() => {
              if (["llama3", "phi3", "mistral"].includes(localSettings.modelName)) {
                setLocalSettings({ ...localSettings, modelName: "" });
              }
            }}
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
      </div>

      <div className="popover-footer">
        <button className="link-btn" onClick={() => setShowShortcuts(true)}>Shortcuts</button>
        <button className="btn-save-sm" onClick={handleSave}>Save</button>
      </div>

      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} isLG={isLG} />}
    </div>
  );
}
