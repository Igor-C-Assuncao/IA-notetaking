// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { useState } from "react";
import { useSettings } from "@app/providers/SettingsProvider";

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings, updateSettings } = useSettings();
  const [localSettings, setLocalSettings] = useState(settings);

  const handleSave = async () => {
    await updateSettings(localSettings);
    onClose();
  };

  const handleResetSetup = async () => {
    if (confirm("Are you sure you want to run the setup wizard again?")) {
      await updateSettings({ onboarding_completed: false });
      window.location.reload();
    }
  };

  return (
    <div className="modal-overlay">
      <div className="settings-modal">
        <h3>IA Configuration</h3>
        <div className="form-group">
          <label>Theme</label>
          <select value={localSettings.theme} onChange={(e) => setLocalSettings({ ...localSettings, theme: e.target.value })}>
            <option value="liquid-glass">Liquid Glass (Dark)</option>
            <option value="minimalist-notebook">Notebook Paper (Light)</option>
          </select>
        </div>
        <div className="form-group">
          <label>LLM Provider</label>
          <select value={localSettings.provider} onChange={(e) => setLocalSettings({ ...localSettings, provider: e.target.value })}>
            <option value="ollama">Ollama (Local)</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Google Gemini</option>
            <option value="anthropic">Anthropic Claude</option>
          </select>
        </div>
        <div className="form-group">
          <label>Model Name</label>
          <input type="text" value={localSettings.modelName} onChange={(e) => setLocalSettings({ ...localSettings, modelName: e.target.value })} />
        </div>
        {localSettings.provider !== "ollama" && (
          <div className="form-group">
            <label>API Key</label>
            <input type="password" value={localSettings.apiKey} placeholder="Enter your key…" onChange={(e) => setLocalSettings({ ...localSettings, apiKey: e.target.value })} />
          </div>
        )}
        <div className="form-group">
          <label>Custom System Prompt <span className="form-hint">Optional — guides the AI output style</span></label>
          <textarea
            className="system-prompt-textarea"
            value={localSettings.systemPrompt}
            onChange={(e) => setLocalSettings({ ...localSettings, systemPrompt: e.target.value })}
            placeholder={"Examples:\n• Bullet points only\n• Focus on action items\n• Translate output to Portuguese\n• Keep summary under 200 words"}
            rows={4}
          />
        </div>
        <div className="form-group" style={{ marginTop: "16px", borderTop: "1px solid var(--border)", paddingTop: "16px" }}>
          <button className="btn-cancel" onClick={handleResetSetup} style={{ width: "100%", textAlign: "center", color: "#ff5f57", borderColor: "rgba(255,95,87,0.3)" }}>
            Reset Setup Wizard
          </button>
        </div>
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn-save" onClick={handleSave}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}
