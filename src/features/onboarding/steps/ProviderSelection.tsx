// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { Dispatch, SetStateAction } from "react";
import { WizardState } from "../OnboardingWizard";

interface Props {
  state: WizardState;
  setState: Dispatch<SetStateAction<WizardState>>;
  onNext: () => void;
}

export function ProviderSelection({ state, setState, onNext }: Props) {
  
  const selectLocal = () => {
    setState(s => ({ ...s, providerType: "local", providerName: "ollama" }));
  };

  const selectCloud = (provider: string) => {
    setState(s => ({ ...s, providerType: "cloud", providerName: provider }));
  };

  return (
    <div className="wizard-step">
      <h3>Where should AI run?</h3>
      <p className="step-desc">Choose between running models locally on your hardware or using cloud APIs.</p>

      <div className="cards-row">
        <div className={`choice-card ${state.providerType === "local" ? "active" : ""}`} onClick={selectLocal}>
          <h4>🖥️ Run locally (Recommended)</h4>
          <ul className="choice-bullets">
            <li>Free and unlimited</li>
            <li>100% private — data never leaves your machine</li>
            <li>Requires Ollama installed (8GB+ VRAM recommended)</li>
          </ul>
        </div>

        <div className={`choice-card ${state.providerType === "cloud" ? "active" : ""}`}>
          <h4>☁️ Use cloud APIs</h4>
          <ul className="choice-bullets">
            <li>Pay-per-use to the provider</li>
            <li>Data is sent to OpenAI / Anthropic / Google</li>
            <li>Works fast on any hardware</li>
          </ul>
          {state.providerType === "cloud" && (
            <div className="cloud-subpicker">
              <button 
                className={`sub-btn ${state.providerName === "openai" ? "selected" : ""}`}
                onClick={(e) => { e.stopPropagation(); selectCloud("openai"); }}>OpenAI</button>
              <button 
                className={`sub-btn ${state.providerName === "anthropic" ? "selected" : ""}`}
                onClick={(e) => { e.stopPropagation(); selectCloud("anthropic"); }}>Anthropic</button>
              <button 
                className={`sub-btn ${state.providerName === "gemini" ? "selected" : ""}`}
                onClick={(e) => { e.stopPropagation(); selectCloud("gemini"); }}>Gemini</button>
            </div>
          )}
          {state.providerType !== "cloud" && (
            <button className="sub-btn-ghost" onClick={(e) => { e.stopPropagation(); selectCloud("openai"); }}>
              Select Cloud
            </button>
          )}
        </div>
      </div>

      <div className="wizard-footer">
        <div /> {/* spacing */}
        <button 
          className="btn-primary" 
          onClick={onNext} 
          disabled={!state.providerType}
        >
          Next
        </button>
      </div>

      <style>{`
        .wizard-step { display: flex; flex-direction: column; height: 100%; }
        h3 { font-size: 16px; margin-bottom: 8px; }
        .step-desc { font-size: 13px; color: var(--text-dim); margin-bottom: 24px; }
        
        .cards-row {
          display: flex; gap: 16px; flex: 1;
        }
        .choice-card {
          flex: 1;
          border: 1.5px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 20px;
          cursor: pointer;
          background: var(--bg-panel);
          transition: all 150ms;
          display: flex;
          flex-direction: column;
        }
        .choice-card:hover { border-color: var(--text-faint); }
        .choice-card.active {
          border-color: var(--accent);
          background: var(--accent-bg);
        }
        .choice-card h4 { font-size: 14px; margin-bottom: 12px; }
        .choice-bullets { margin-left: 20px; font-size: 12.5px; color: var(--text-dim); line-height: 1.6; flex: 1; }
        
        .cloud-subpicker {
          display: flex; gap: 8px; margin-top: 16px;
        }
        .sub-btn {
          flex: 1; padding: 6px; font-size: 11px;
          background: var(--bg-input); border: 1px solid var(--border);
          border-radius: var(--radius-sm); color: var(--text); cursor: pointer;
        }
        .sub-btn:hover { background: var(--bg-hover); }
        .sub-btn.selected { background: var(--accent); color: #fff; border-color: var(--accent); }
        
        .sub-btn-ghost {
          margin-top: 16px; padding: 6px; font-size: 11px;
          background: transparent; border: 1px dashed var(--border);
          border-radius: var(--radius-sm); color: var(--text-dim); cursor: pointer;
        }
        .sub-btn-ghost:hover { border-style: solid; color: var(--text); }

        .wizard-footer {
          display: flex; justify-content: space-between; align-items: center;
          margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border);
        }
        .btn-primary {
          background: var(--accent); color: #fff; border: none; padding: 8px 24px;
          border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; cursor: pointer;
        }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
