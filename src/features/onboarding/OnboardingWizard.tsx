import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "@app/providers/SettingsProvider";

import { ProviderSelection } from "./steps/ProviderSelection";
import { OllamaSetup } from "./steps/OllamaSetup";
import { CloudValidation } from "./steps/CloudValidation";
import { HuggingFaceSetup } from "./steps/HuggingFaceSetup";
import { ThemeAndDevice } from "./steps/ThemeAndDevice";

export interface WizardState {
  providerType: "local" | "cloud" | null;
  providerName: string; // "ollama", "openai", "anthropic", "gemini"
  model: string;
  apiKey: string;
  hfToken: string;
  diarization: boolean;
  theme: string;
  selectedDeviceId: number | null;
}

export function OnboardingWizard() {
  const { settings, updateSettings } = useSettings();

  const [step, setStep] = useState(1);
  const [wizardState, setWizardState] = useState<WizardState>({
    providerType: null,
    providerName: "ollama",
    model: "gemma4:e2b",
    apiKey: "",
    hfToken: "",
    diarization: false,
    theme: settings.theme || "liquid-glass",
    selectedDeviceId: settings.selectedDeviceId,
  });
  const [finishError, setFinishError] = useState("");
  const [isFinishing, setIsFinishing] = useState(false);

  useEffect(() => {
    invoke("set_wizard_mode").catch(console.error);
  }, []);

  const handleNext = () => setStep((s) => s + 1);
  const handlePrev = () => setStep((s) => s - 1);

  const handleFinish = async () => {
    setIsFinishing(true);
    setFinishError("");
    try {
      await updateSettings({
        provider: wizardState.providerName,
        modelName: wizardState.model,
        apiKey: wizardState.apiKey,
        hf_token: wizardState.hfToken,
        theme: wizardState.theme,
        speakerDiarization: wizardState.diarization,
        selectedDeviceId: wizardState.selectedDeviceId,
        onboarding_completed: true,
      });

      await invoke("set_compact_mode").catch(console.error);
    } catch (error) {
      console.error("Failed to finish onboarding:", error);
      setFinishError("Could not save your setup. Please try again.");
    } finally {
      setIsFinishing(false);
    }
  };

  const skipSetup = async () => {
    if (confirm("Skip setup? Default settings will be used. You can reconfigure later in Settings.")) {
      await updateSettings({ onboarding_completed: true });
      await invoke("set_compact_mode").catch(console.error);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 1:
        return <ProviderSelection state={wizardState} setState={setWizardState} onNext={handleNext} />;
      case 2:
        if (wizardState.providerType === "local") {
          return <OllamaSetup state={wizardState} setState={setWizardState} onNext={handleNext} onPrev={handlePrev} />;
        } else {
          return <CloudValidation state={wizardState} setState={setWizardState} onNext={handleNext} onPrev={handlePrev} />;
        }
      case 3:
        return <HuggingFaceSetup state={wizardState} setState={setWizardState} onNext={handleNext} onPrev={handlePrev} />;
      case 4:
        return <ThemeAndDevice state={wizardState} setState={setWizardState} onFinish={handleFinish} onPrev={handlePrev} isFinishing={isFinishing} />;
      default:
        return null;
    }
  };

  return (
    <div className="onboarding-wizard">
      <div className="wizard-header">
        <h2>Welcome to AI NoteTaking</h2>
        <button className="btn-skip" onClick={skipSetup}>Skip Setup</button>
      </div>
      
      <div className="wizard-body">
        {renderStep()}
        {finishError && <p className="wizard-error" role="alert">{finishError}</p>}
      </div>

      <style>{`
        .onboarding-wizard {
          display: flex;
          flex-direction: column;
          height: 100vh;
          background: var(--bg-app);
          color: var(--text);
          padding: 24px 32px;
        }
        .wizard-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
        }
        .wizard-header h2 {
          font-size: 18px;
          font-weight: 600;
          letter-spacing: -0.01em;
        }
        .btn-skip {
          font-size: 12px;
          color: var(--text-faint);
          background: transparent;
          cursor: pointer;
        }
        .btn-skip:hover { color: var(--text); }
        .wizard-body {
          flex: 1;
          display: flex;
          flex-direction: column;
          overflow-y: auto;
        }
        .wizard-error {
          color: #ff5f57;
          font-size: 12px;
          margin-top: 12px;
        }
      `}</style>
    </div>
  );
}
