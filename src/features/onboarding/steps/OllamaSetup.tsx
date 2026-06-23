import { useState, useEffect, Dispatch, SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WizardState } from "../OnboardingWizard";

interface Props {
  state: WizardState;
  setState: Dispatch<SetStateAction<WizardState>>;
  onNext: () => void;
  onPrev: () => void;
}

export function OllamaSetup({ state, setState, onNext, onPrev }: Props) {
  const [status, setStatus] = useState<"checking" | "not-found" | "installing" | "ready" | "missing-model" | "pulling">("checking");
  const [installedModels, setInstalledModels] = useState<string[]>([]);
  const [pullProgress, setPullProgress] = useState<{ total: number, completed: number, status: string }>({ total: 0, completed: 0, status: "" });
  const [pullError, setPullError] = useState("");
  const [installMessage, setInstallMessage] = useState("");

  const recommendedModels = [
    { name: "llama3.1:8b", description: "Balanced for meeting notes and summaries." },
    { name: "qwen2.5:7b", description: "Good for technical text and light reasoning." },
    { name: "gemma3:4b", description: "Lighter option for modest computers." },
  ];
  
  const checkOllama = async () => {
    setStatus("checking");
    try {
      const data = await invoke<{ installed: boolean; running: boolean; models: string[]; message: string }>("check_ollama");
      if (!data.running) {
        setInstallMessage(data.message);
        setStatus("not-found");
        return;
      }
      const models = data.models || [];
      setInstalledModels(models);
      
      const modelInstalled = models.some((model: string) => {
        const installedName = model.replace(/:latest$/, "");
        const selectedName = state.model.replace(/:latest$/, "");
        return installedName === selectedName;
      });
      if (modelInstalled) {
        setStatus("ready");
      } else {
        setStatus("missing-model");
      }
    } catch (e) {
      console.error(e);
      setInstallMessage("Could not check Ollama. Install or open Ollama, then retry.");
      setStatus("not-found");
    }
  };

  useEffect(() => {
    checkOllama();
  }, [state.model]);

  useEffect(() => {
    let unlistenInstall: (() => void) | undefined;
    let unlistenPull: (() => void) | undefined;

    listen<{ stage: string; message: string }>("ollama-install-progress", (event) => {
      setInstallMessage(event.payload.message);
    }).then((fn) => {
      unlistenInstall = fn;
    });

    listen<{ status?: string; total?: number; completed?: number }>("ollama-pull-progress", (event) => {
      setPullProgress({
        status: event.payload.status || "Downloading model",
        total: event.payload.total || 0,
        completed: event.payload.completed || 0,
      });
    }).then((fn) => {
      unlistenPull = fn;
    });

    return () => {
      unlistenInstall?.();
      unlistenPull?.();
    };
  }, []);

  const installOllama = async () => {
    setStatus("installing");
    setInstallMessage("Starting Windows Package Manager. Windows may show an installation prompt.");
    try {
      await invoke("install_ollama_winget");
      setInstallMessage("Ollama installed. Start Ollama if it did not open automatically, then re-check.");
      await checkOllama();
    } catch (e) {
      console.error("Failed to install Ollama", e);
      setStatus("not-found");
      setInstallMessage("Windows Package Manager could not install Ollama. You can still install it manually from ollama.com/download.");
    }
  };

  const pullModel = async () => {
    setStatus("pulling");
    setPullError("");
    try {
      await invoke("pull_ollama_model", { model: state.model });
      setStatus("ready");
      await checkOllama();
    } catch (e) {
      console.error("Failed to pull model", e);
      setStatus("missing-model");
      setPullError("The model download failed. Check that Ollama is running, verify internet and disk space, then retry.");
    }
  };

  return (
    <div className="wizard-step">
      <h3>Local Setup: Ollama</h3>
      <p className="step-desc">Ollama runs local language models on your computer. It keeps meeting text local, but models can take several GB of disk space.</p>

      <div className="status-box">
        {status === "checking" && (
          <div className="state-checking">
            <span className="spinner"></span> Checking whether Ollama is open...
          </div>
        )}
        
        {status === "not-found" && (
          <div className="state-error">
            <h4>Ollama not ready</h4>
            <p>{installMessage || "We couldn't connect to Ollama. Install it with winget or start the Ollama app if it is already installed."}</p>
            <button className="btn-secondary" onClick={installOllama}>
              Install automatically with Windows
            </button>
            <button className="btn-secondary" onClick={checkOllama} style={{ marginLeft: 8 }}>
              Re-check
            </button>
          </div>
        )}

        {status === "installing" && (
          <div className="state-checking">
            <span className="spinner"></span> {installMessage || "Installing Ollama with winget..."}
          </div>
        )}

        {status === "missing-model" && (
          <div className="state-missing">
            <h4>Ollama is running</h4>
            <p>The selected model <strong>{state.model}</strong> is not installed yet. Download it once, then it runs locally.</p>
            {pullError && <p className="state-error-message" role="alert">{pullError}</p>}
            <button className="btn-primary" onClick={pullModel} style={{ marginTop: 12 }}>
              {pullError ? "Retry Download" : "Download Model"}
            </button>
          </div>
        )}

        {status === "pulling" && (
          <div className="state-pulling">
            <h4>Downloading {state.model}...</h4>
            <progress
              className="progress-bar-bg"
              max={pullProgress.total || 1}
              value={pullProgress.completed}
              aria-label={`Downloading ${state.model}`}
            />
            <p className="progress-text">
              {pullProgress.status} 
              {pullProgress.total > 0 && ` - ${(pullProgress.completed / 1024 / 1024).toFixed(1)} MB / ${(pullProgress.total / 1024 / 1024).toFixed(1)} MB`}
            </p>
          </div>
        )}

        {status === "ready" && (
          <div className="state-ready">
            <h4>Ready to go</h4>
            <p>Ollama is running and <strong>{state.model}</strong> is installed.</p>
          </div>
        )}
      </div>

      {status !== "pulling" && (
        <div className="advanced-options">
          <label>Recommended local models:</label>
          <div className="model-recommendations">
            {recommendedModels.map((model) => (
              <button
                key={model.name}
                type="button"
                className={`model-chip ${state.model === model.name ? "active" : ""}`}
                onClick={() => setState(s => ({ ...s, model: model.name }))}
              >
                <strong>{model.name}</strong>
                <span>{model.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {installedModels.length > 0 && status !== "pulling" && (
        <div className="advanced-options">
          <label>Installed models:</label>
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
          border: none; border-radius: 4px; overflow: hidden; margin-bottom: 8px;
        }
        .progress-bar-bg::-webkit-progress-bar { background: var(--bg-input); }
        .progress-bar-bg::-webkit-progress-value { background: var(--accent); transition: width 0.2s; }
        .progress-text { font-size: 11px; font-variant-numeric: tabular-nums; }
        .state-error-message { color: #ff5f57; }

        .advanced-options {
          margin-top: 16px; display: flex; flex-direction: column; gap: 6px;
        }
        .advanced-options label { font-size: 11px; color: var(--text-faint); }
        .model-recommendations {
          display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px;
        }
        .model-chip {
          display: flex; flex-direction: column; gap: 4px; min-height: 76px;
          text-align: left; padding: 10px; border-radius: var(--radius-sm);
          border: 1px solid var(--border); background: var(--bg-input);
          color: var(--text); cursor: pointer;
        }
        .model-chip.active { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
        .model-chip strong { font-size: 11px; }
        .model-chip span { font-size: 10.5px; color: var(--text-dim); line-height: 1.35; }
        .model-select {
          padding: 8px 28px 8px 8px; background: var(--bg-input); border: 1px solid var(--border);
          color: var(--text); border-radius: var(--radius-sm); font-size: 13px; outline: none;
          -webkit-appearance: none; -moz-appearance: none; appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg fill='rgba(255,255,255,0.6)' height='24' viewBox='0 0 24 24' width='24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 8px center; background-size: 18px;
        }
        [data-theme="minimalist-notebook"] .model-select {
          background-image: url("data:image/svg+xml,%3Csvg fill='%231a1814' height='24' viewBox='0 0 24 24' width='24' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E");
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
