// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { useState, Dispatch, SetStateAction } from "react";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { WizardState } from "../OnboardingWizard";

interface Props {
  state: WizardState;
  setState: Dispatch<SetStateAction<WizardState>>;
  onNext: () => void;
  onPrev: () => void;
}

export function CloudValidation({ state, setState, onNext, onPrev }: Props) {
  const [isValidating, setIsValidating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isValid, setIsValid] = useState(false);

  const providerLabels: Record<string, string> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    gemini: "Google Gemini",
  };

  const validateKey = async () => {
    const apiKey = state.apiKey.trim();
    if (!apiKey) {
      setErrorMsg("Please enter an API key.");
      return;
    }

    setIsValidating(true);
    setErrorMsg("");
    setIsValid(false);

    try {
      let res;
      if (state.providerName === "openai") {
        res = await tauriFetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
      } else if (state.providerName === "anthropic") {
        res = await tauriFetch("https://api.anthropic.com/v1/models", {
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
        });
      } else if (state.providerName === "gemini") {
        res = await tauriFetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
      } else {
        throw new Error("Unknown provider");
      }

      if (res.ok) {
        setIsValid(true);
        setState(s => ({ ...s, apiKey }));
      } else if (res.status === 401 || res.status === 403) {
        setErrorMsg("The credential was rejected. Check the key and its provider permissions.");
      } else if (res.status === 429) {
        setErrorMsg("The provider rate limit was reached. Wait briefly and try again.");
      } else {
        const txt = await res.text();
        console.error("API Error:", txt);
        setErrorMsg(`Provider validation failed (HTTP ${res.status}). Please try again.`);
      }
    } catch (e: any) {
      setErrorMsg(e?.message ? `Could not reach the provider: ${e.message}` : "Could not reach the provider.");
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="wizard-step">
      <h3>Cloud Setup: {providerLabels[state.providerName] || "Provider"}</h3>
      <p className="step-desc">Enter your API key to continue. We'll validate it immediately.</p>

      <div className="validation-box">
        <label className="input-label">API Key</label>
        <div className="input-row">
          <input
            type="password"
            value={state.apiKey}
            onChange={(e) => {
              setState(s => ({ ...s, apiKey: e.target.value }));
              setIsValid(false);
              setErrorMsg("");
            }}
            placeholder="sk-..."
            className="key-input"
            disabled={isValidating || isValid}
          />
          {!isValid && (
            <button className="btn-validate" onClick={validateKey} disabled={isValidating}>
              {isValidating ? <span className="spinner-sm"></span> : `Connect ${providerLabels[state.providerName] || "Provider"}`}
            </button>
          )}
        </div>
        
        {errorMsg && <p className="error-msg" role="alert">❌ {errorMsg}</p>}
        {isValid && <p className="success-msg" role="status">✅ Connection verified.</p>}

        {isValid && (
          <button className="btn-text" onClick={() => setIsValid(false)}>
            Change key
          </button>
        )}
      </div>

      <div className="wizard-footer">
        <button className="btn-secondary" onClick={onPrev}>Back</button>
        <button 
          className="btn-primary" 
          onClick={onNext} 
          disabled={!isValid}
        >
          Next
        </button>
      </div>

      <style>{`
        .wizard-step { display: flex; flex-direction: column; height: 100%; }
        h3 { font-size: 16px; margin-bottom: 8px; }
        .step-desc { font-size: 13px; color: var(--text-dim); margin-bottom: 24px; }
        
        .validation-box {
          background: var(--bg-panel);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 24px;
          flex: 1;
        }

        .input-label { font-size: 11px; font-weight: 600; color: var(--text-faint); margin-bottom: 8px; display: block; }
        .input-row { display: flex; gap: 8px; margin-bottom: 12px; }
        
        .key-input {
          flex: 1; padding: 10px 14px; background: var(--bg-input); border: 1px solid var(--border);
          color: var(--text); border-radius: var(--radius-sm); font-size: 14px; font-family: var(--font-mono, monospace);
        }
        .key-input:disabled { opacity: 0.6; cursor: not-allowed; }

        .btn-validate {
          background: var(--bg-hover); border: 1px solid var(--border); color: var(--text);
          padding: 0 16px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 500; cursor: pointer;
        }
        .btn-validate:hover:not(:disabled) { background: var(--text-faint); color: #fff; }

        .spinner-sm {
          display: inline-block; width: 12px; height: 12px;
          border: 2px solid var(--text-faint); border-top-color: var(--text);
          border-radius: 50%; animation: spin 1s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .error-msg { color: #ff5f57; font-size: 12px; margin-top: 8px; }
        .success-msg { color: var(--green); font-size: 12px; margin-top: 8px; font-weight: 600; }

        .btn-text {
          background: none; border: none; color: var(--accent); font-size: 11px;
          cursor: pointer; margin-top: 12px; padding: 0;
        }
        .btn-text:hover { text-decoration: underline; }

        .btn-secondary {
          background: var(--bg-input); color: var(--text); border: 1px solid var(--border);
          padding: 6px 14px; border-radius: var(--radius-sm); font-size: 12px; cursor: pointer;
        }
        .btn-secondary:hover { background: var(--bg-hover); }

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
