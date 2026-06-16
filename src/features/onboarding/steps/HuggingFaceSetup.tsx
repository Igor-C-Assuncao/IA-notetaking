import { useState, Dispatch, SetStateAction } from "react";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { WizardState } from "../OnboardingWizard";

interface Props {
  state: WizardState;
  setState: Dispatch<SetStateAction<WizardState>>;
  onNext: () => void;
  onPrev: () => void;
}

export function HuggingFaceSetup({ state, setState, onNext, onPrev }: Props) {
  const [isValidating, setIsValidating] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [isValid, setIsValid] = useState(false);
  const [username, setUsername] = useState("");
  const [needsModelAccess, setNeedsModelAccess] = useState(false);

  const validateToken = async () => {
    const token = state.hfToken.trim();
    if (!token) {
      setErrorMsg("Please enter a HuggingFace token.");
      return;
    }

    setIsValidating(true);
    setErrorMsg("");
    setIsValid(false);
    setNeedsModelAccess(false);

    try {
      const identityResponse = await tauriFetch("https://huggingface.co/api/whoami-v2", {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      if (identityResponse.status === 401 || identityResponse.status === 403) {
        setErrorMsg("Invalid token or insufficient read access. Check the token permissions.");
        return;
      }
      if (identityResponse.status === 429) {
        setErrorMsg("HuggingFace rate limit reached. Please wait and try again.");
        return;
      }
      if (!identityResponse.ok) {
        setErrorMsg(`HuggingFace validation failed (HTTP ${identityResponse.status}). Please try again.`);
        return;
      }

      const identity = await identityResponse.json() as { name?: string };
      setUsername(identity.name || "User");

      const modelResponse = await tauriFetch(
        "https://huggingface.co/pyannote/speaker-diarization-3.1/resolve/main/config.yaml",
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      if (modelResponse.status === 401 || modelResponse.status === 403) {
        setNeedsModelAccess(true);
        setErrorMsg("Token verified, but Pyannote model access is not enabled. Accept the model terms, then re-check.");
        return;
      }
      if (!modelResponse.ok) {
        setErrorMsg(`Pyannote access check failed (HTTP ${modelResponse.status}). Please try again.`);
        return;
      }

      setIsValid(true);
      setState(s => ({ ...s, hfToken: token, diarization: true }));
    } catch (e: any) {
      setErrorMsg(e?.message ? `Could not reach HuggingFace: ${e.message}` : "Could not reach HuggingFace.");
    } finally {
      setIsValidating(false);
    }
  };

  const skipStep = () => {
    setState(s => ({ ...s, hfToken: "", diarization: false }));
    onNext();
  };

  return (
    <div className="wizard-step">
      <h3>Speaker Diarization (Optional)</h3>
      <p className="step-desc">Identify who is speaking ("Speaker 1", "Speaker 2").</p>

      <div className="hf-box">
        <ul className="info-bullets">
          <li>Requires a free HuggingFace account</li>
          <li>Increases transcription time slightly</li>
          <li>You must accept the model terms for pyannote/speaker-diarization-3.1</li>
        </ul>

        <div className="links-row">
          <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">1. Get Token</a>
          <a href="https://huggingface.co/pyannote/speaker-diarization-3.1" target="_blank" rel="noreferrer">2. Accept Terms</a>
        </div>

        <label className="input-label">HuggingFace Token (Read access)</label>
        <div className="input-row">
          <input
            type="password"
            value={state.hfToken}
            onChange={(e) => {
              setState(s => ({ ...s, hfToken: e.target.value }));
              setIsValid(false);
              setNeedsModelAccess(false);
              setErrorMsg("");
            }}
            placeholder="hf_..."
            className="key-input"
            disabled={isValidating || isValid}
          />
          {!isValid && (
            <button className="btn-validate" onClick={validateToken} disabled={isValidating}>
              {isValidating ? <span className="spinner-sm"></span> : "Validate"}
            </button>
          )}
        </div>
        
        {errorMsg && <p className="error-msg" role="alert">❌ {errorMsg}</p>}
        {needsModelAccess && (
          <div className="model-access-actions">
            <a
              className="btn-text"
              href="https://huggingface.co/pyannote/speaker-diarization-3.1"
              target="_blank"
              rel="noreferrer"
            >
              Open model terms
            </a>
            <button className="btn-text" onClick={validateToken}>Re-check access</button>
          </div>
        )}
        {isValid && (
          <p className="success-msg" role="status">
            ✅ Token and Pyannote access confirmed for <strong>{username}</strong>.
          </p>
        )}
      </div>

      <div className="wizard-footer">
        <button className="btn-secondary" onClick={onPrev}>Back</button>
        <div className="footer-right">
          {!isValid && <button className="btn-text" onClick={skipStep} style={{ marginRight: 16 }}>Skip for now</button>}
          <button 
            className="btn-primary" 
            onClick={onNext} 
            disabled={!isValid && state.hfToken.trim().length > 0} // force validate or skip if they typed something
          >
            {isValid ? "Next" : "Skip & Continue"}
          </button>
        </div>
      </div>

      <style>{`
        .wizard-step { display: flex; flex-direction: column; height: 100%; }
        h3 { font-size: 16px; margin-bottom: 8px; }
        .step-desc { font-size: 13px; color: var(--text-dim); margin-bottom: 24px; }
        
        .hf-box {
          background: var(--bg-panel);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 24px;
          flex: 1;
        }

        .info-bullets { margin-left: 20px; font-size: 12.5px; color: var(--text-dim); line-height: 1.6; margin-bottom: 16px; }
        
        .links-row { display: flex; gap: 16px; margin-bottom: 24px; }
        .links-row a { font-size: 12px; color: var(--accent); text-decoration: none; font-weight: 500; }
        .links-row a:hover { text-decoration: underline; }

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
        .success-msg { color: var(--green); font-size: 12px; margin-top: 8px; }
        .model-access-actions { display: flex; gap: 16px; align-items: center; margin-top: 10px; }

        .btn-text {
          background: none; border: none; color: var(--text-faint); font-size: 12px;
          cursor: pointer; padding: 0;
        }
        .btn-text:hover { color: var(--text); text-decoration: underline; }

        .btn-secondary {
          background: var(--bg-input); color: var(--text); border: 1px solid var(--border);
          padding: 6px 14px; border-radius: var(--radius-sm); font-size: 12px; cursor: pointer;
        }
        .btn-secondary:hover { background: var(--bg-hover); }

        .wizard-footer {
          display: flex; justify-content: space-between; align-items: center;
          margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border);
        }
        .footer-right { display: flex; align-items: center; }
        .btn-primary {
          background: var(--accent); color: #fff; border: none; padding: 8px 24px;
          border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; cursor: pointer;
        }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
