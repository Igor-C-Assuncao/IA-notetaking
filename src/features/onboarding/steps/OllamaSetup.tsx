import { useState, useEffect, Dispatch, SetStateAction } from "react";
import { WizardState } from "../OnboardingWizard";

interface Props {
  state: WizardState;
  setState: Dispatch<SetStateAction<WizardState>>;
  onNext: () => void;
  onPrev: () => void;
}

export function OllamaSetup({ state, setState, onNext, onPrev }: Props) {
  const [status, setStatus] = useState<"checking" | "not-found" | "ready" | "missing-model" | "pulling">("checking");
  const [installedModels, setInstalledModels] = useState<string[]>([]);
  const [pullProgress, setPullProgress] = useState<{ total: number, completed: number, status: string }>({ total: 0, completed: 0, status: "" });
  
  const checkOllama = async () => {
    setStatus("checking");
    try {
      const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(2000) });
      if (!res.ok) throw new Error("Bad response");
      const data = await res.json();
      const models = data.models?.map((m: any) => m.name) || [];
      setInstalledModels(models);
      
      if (models.includes(state.model)) {
        setStatus("ready");
      } else {
        setStatus("missing-model");
      }
    } catch (e) {
      console.error(e);
      setStatus("not-found");
    }
  };

  useEffect(() => {
    checkOllama();
  }, [state.model]);

  const pullModel = async () => {
    setStatus("pulling");
    try {
      const res = await fetch("http://localhost:11434/api/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: state.model }),
      });
      
      if (!res.body) throw new Error("No body in response");
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const lines = decoder.decode(value).split("\n").filter(l => l.trim());
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.status) {
              setPullProgress({
                status: parsed.status,
                total: parsed.total || 0,
                completed: parsed.completed || 0
              });
            }
          } catch (e) { /* ignore partial json */ }
        }
      }
      setStatus("ready");
    } catch (e) {
      console.error("Failed to pull model", e);
      setStatus("missing-model");
      alert("Failed to download model. Ensure Ollama is running and you have internet access.");
    }
  };

  return (
    <div className="wizard-step">
      <h3>Local Setup: Ollama</h3>
      <p className="step-desc">We need to ensure the local AI engine is running and has the required model.</p>

      <div className="status-box">
        {status === "checking" && (
          <div className="state-checking">
            <span className="spinner"></span> Checking localhost:11434...
          </div>
        )}
        
        {status === "not-found" && (
          <div className="state-error">
            <h4>❌ Ollama not detected</h4>
            <p>We couldn't connect to Ollama. Please ensure it is installed and running.</p>
            <button className="btn-secondary" onClick={() => window.open("https://ollama.com/download", "_blank")}>
              Download Ollama
            </button>
            <button className="btn-secondary" onClick={checkOllama} style={{ marginLeft: 8 }}>
              Re-check
            </button>
          </div>
        )}

        {status === "missing-model" && (
          <div className="state-missing">
            <h4>✅ Ollama is running</h4>
            <p>But the recommended model ({state.model}) is not installed. (~1.5GB)</p>
            <button className="btn-primary" onClick={pullModel} style={{ marginTop: 12 }}>
              Download Model
            </button>
          </div>
        )}

        {status === "pulling" && (
          <div className="state-pulling">
            <h4>Downloading {state.model}...</h4>
            <div className="progress-bar-bg">
              <div 
                className="progress-bar-fill" 
                style={{ width: pullProgress.total > 0 ? `${(pullProgress.completed / pullProgress.total) * 100}%` : "0%" }}
              />
            </div>
            <p className="progress-text">
              {pullProgress.status} 
              {pullProgress.total > 0 && ` - ${(pullProgress.completed / 1024 / 1024).toFixed(1)} MB / ${(pullProgress.total / 1024 / 1024).toFixed(1)} MB`}
            </p>
          </div>
        )}

        {status === "ready" && (
          <div className="state-ready">
            <h4>✅ Ready to go</h4>
            <p>Ollama is running and <strong>{state.model}</strong> is installed.</p>
          </div>
        )}
      </div>

      {installedModels.length > 0 && status !== "pulling" && (
        <div className="advanced-options">
          <label>Installed Models (Advanced):</label>
          <select 
            value={state.model} 
            onChange={(e) => setState(s => ({ ...s, model: e.target.value }))}
            className="model-select"
          >
            {!installedModels.includes(state.model) && (
              <option value={state.model}>{state.model} (Not installed)</option>
            )}
            {installedModels.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      )}

      <div className="wizard-footer">
        <button className="btn-secondary" onClick={onPrev}>Back</button>
        <button 
          className="btn-primary" 
          onClick={onNext} 
          disabled={status !== "ready"}
        >
          Next
        </button>
      </div>

      <style>{`
        .wizard-step { display: flex; flex-direction: column; height: 100%; }
        h3 { font-size: 16px; margin-bottom: 8px; }
        .step-desc { font-size: 13px; color: var(--text-dim); margin-bottom: 24px; }
        
        .status-box {
          background: var(--bg-panel);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 24px;
          flex: 1;
        }

        h4 { margin-bottom: 8px; font-size: 14px; }
        p { font-size: 13px; color: var(--text-dim); line-height: 1.5; margin-bottom: 12px; }

        .spinner {
          display: inline-block; width: 14px; height: 14px;
          border: 2px solid var(--text-faint);
          border-top-color: var(--text);
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin-right: 8px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }

        .btn-secondary {
          background: var(--bg-input); color: var(--text); border: 1px solid var(--border);
          padding: 6px 14px; border-radius: var(--radius-sm); font-size: 12px; cursor: pointer;
        }
        .btn-secondary:hover { background: var(--bg-hover); }

        .progress-bar-bg {
          width: 100%; height: 8px; background: var(--bg-input);
          border-radius: 4px; overflow: hidden; margin-bottom: 8px;
        }
        .progress-bar-fill {
          height: 100%; background: var(--accent); transition: width 0.2s;
        }
        .progress-text { font-size: 11px; font-variant-numeric: tabular-nums; }

        .advanced-options {
          margin-top: 16px; display: flex; flex-direction: column; gap: 6px;
        }
        .advanced-options label { font-size: 11px; color: var(--text-faint); }
        .model-select {
          padding: 8px; background: var(--bg-input); border: 1px solid var(--border);
          color: var(--text); border-radius: var(--radius-sm); font-size: 13px; outline: none;
        }

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
