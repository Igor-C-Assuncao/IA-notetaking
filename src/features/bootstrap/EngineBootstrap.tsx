import { ReactNode, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettings } from "@app/providers/SettingsProvider";
import { usePythonEvent } from "@app/providers/IpcProvider";

type EngineKind = "cpu" | "gpu";

interface EngineStatus {
  installed: boolean;
  kind: EngineKind;
  version: string;
  path?: string | null;
  size_bytes?: number | null;
  dev_mode: boolean;
}

interface ProgressPayload {
  kind: EngineKind;
  stage: string;
  downloadedBytes: number;
  totalBytes?: number | null;
  message: string;
}

const ENGINE_COPY: Record<EngineKind, { title: string; body: string; details: string }> = {
  cpu: {
    title: "CPU",
    body: "Recommended if you are not sure. Works on most Windows computers.",
    details: "Slower than GPU, but avoids NVIDIA/CUDA driver requirements.",
  },
  gpu: {
    title: "GPU",
    body: "Faster local transcription on compatible NVIDIA machines.",
    details: "Use this if you have updated NVIDIA drivers. If it fails, switch back to CPU.",
  },
};

function formatBytes(bytes?: number | null) {
  if (!bytes) return "";
  const units = ["B", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function EngineBootstrap({ children }: { children: ReactNode }) {
  const { settings, updateSettings } = useSettings();
  const win = getCurrentWindow();
  const isLightTheme = settings.theme === "minimalist-notebook";
  const [engineKind, setEngineKind] = useState<EngineKind>(settings.engineKind || "cpu");
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [phase, setPhase] = useState<"checking" | "choose" | "downloading" | "starting" | "ready" | "error">("checking");
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [message, setMessage] = useState("Checking the local transcription component...");
  const [error, setError] = useState("");
  const [startupSlow, setStartupSlow] = useState(false);

  const progressPct = useMemo(() => {
    if (!progress?.totalBytes) return 0;
    return Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100));
  }, [progress]);

  usePythonEvent("SYSTEM_READY", () => {
    setMessage("Transcription component started. Loading local models...");
  });

  usePythonEvent("PREFLIGHT_RESULT", () => {
    if (settings.onboarding_completed) {
      invoke("set_compact_mode").catch(console.error).finally(() => setPhase("ready"));
    } else {
      setPhase("ready");
    }
  });

  usePythonEvent("SIDECAR_FAILED", () => {
    setError("The local transcription component could not start. Try again or switch to CPU.");
    setPhase("error");
  });

  useEffect(() => {
    const unlisten = listen<ProgressPayload>("engine-download-progress", (event) => {
      setProgress(event.payload);
      setMessage(event.payload.message);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    invoke("set_bootstrap_mode").catch(console.error);
    checkEngine(engineKind);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleTheme = async () => {
    const nextTheme = isLightTheme ? "liquid-glass" : "minimalist-notebook";
    document.documentElement.setAttribute("data-theme", nextTheme);
    await updateSettings({ theme: nextTheme });
  };

  const closeWindow = () => {
    if (phase === "downloading" || phase === "starting") {
      const shouldClose = window.confirm("Setup is still running. Closing now may leave a partial download or a component still starting. Close anyway?");
      if (!shouldClose) return;
    }
    win.close();
  };

  const checkEngine = async (kind: EngineKind) => {
    setPhase("checking");
    setStartupSlow(false);
    setError("");
    setMessage("Checking the local transcription component...");
    try {
      const nextStatus = await invoke<EngineStatus>("get_engine_status", { kind });
      setStatus(nextStatus);
      if (nextStatus.installed) {
        await updateSettings({
          engineKind: kind,
          engineVersion: nextStatus.version,
          engineInstalled: true,
          enginePath: nextStatus.path || "",
        });
        await startSidecar(kind);
      } else {
        setPhase("choose");
        setMessage("Choose how local transcription should run on this computer.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  const startSidecar = async (kind: EngineKind) => {
    setPhase("starting");
    setStartupSlow(false);
    setMessage("Starting the local transcription component...");
    try {
      await invoke("start_sidecar", { kind });
      window.setTimeout(() => {
        setPhase((current) => {
          if (current === "starting") {
            setMessage("Still loading WhisperX and local services. The first launch can take a few minutes.");
            setStartupSlow(true);
          }
          return current;
        });
      }, 12000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  const downloadSelectedEngine = async () => {
    setPhase("downloading");
    setStartupSlow(false);
    setError("");
    setProgress(null);
    setMessage("Preparing the transcription component download...");
    try {
      const nextStatus = await invoke<EngineStatus>("download_engine", { kind: engineKind });
      setStatus(nextStatus);
      await updateSettings({
        engineKind,
        engineVersion: nextStatus.version,
        engineInstalled: true,
        enginePath: nextStatus.path || "",
      });
      await startSidecar(engineKind);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  if (phase === "ready") {
    return <>{children}</>;
  }

  return (
    <div className="bootstrap-shell">
      <section className="bootstrap-panel">
        <div className="bootstrap-header">
          <div className="bootstrap-topbar">
            <span className="bootstrap-kicker">First-time setup</span>
            <div className="topbar-actions">
              <button className="theme-toggle-btn" type="button" onClick={toggleTheme}>
                {isLightTheme ? "Dark theme" : "Light theme"}
              </button>
              <button className="topbar-close-btn" type="button" onClick={closeWindow} aria-label="Close">
                ×
              </button>
            </div>
          </div>
          <h1>AI NoteTaking</h1>
          <p>First we prepare the local transcription component. Later you can choose whether note generation uses local AI or a cloud API.</p>
        </div>

        {(phase === "choose" || phase === "error") && (
          <div className="engine-options">
            {(Object.keys(ENGINE_COPY) as EngineKind[]).map((kind) => (
              <button
                key={kind}
                className={`engine-option ${engineKind === kind ? "active" : ""}`}
                onClick={() => setEngineKind(kind)}
                type="button"
              >
                <strong>{ENGINE_COPY[kind].title}</strong>
                <span>{ENGINE_COPY[kind].body}</span>
                <small>{ENGINE_COPY[kind].details}</small>
              </button>
            ))}
          </div>
        )}

        {(phase === "checking" || phase === "starting") && (
          <div className="bootstrap-status">
            <span className="spinner" />
            <div>
              <strong>{phase === "starting" ? "Starting component" : "Checking installation"}</strong>
              <p>{message}</p>
            </div>
          </div>
        )}

        {startupSlow && phase === "starting" && (
          <div className="bootstrap-actions">
            <button className="btn-secondary" type="button" onClick={() => checkEngine(engineKind)}>
              Retry startup
            </button>
            <button className="btn-primary" type="button" onClick={() => setPhase("ready")}>
              Continue setup anyway
            </button>
          </div>
        )}

        {phase === "downloading" && (
          <div className="bootstrap-status">
            <progress className="download-meter" max={100} value={progressPct || undefined} aria-label="Downloading transcription component" />
            <strong>{progress?.stage === "verifying" ? "Verifying package integrity" : "Downloading transcription component"}</strong>
            <p>
              {formatBytes(progress?.downloadedBytes)}
              {progress?.totalBytes ? ` / ${formatBytes(progress.totalBytes)}` : ""} {progressPct ? `(${progressPct}%)` : ""}
            </p>
          </div>
        )}

        {error && <p className="bootstrap-error" role="alert">{error}</p>}

        <div className="bootstrap-actions">
          {(phase === "choose" || phase === "error") && (
            <>
              <button className="btn-secondary" type="button" onClick={() => checkEngine(engineKind)}>
                Check again
              </button>
              <button className="btn-primary" type="button" onClick={downloadSelectedEngine}>
                Download {ENGINE_COPY[engineKind].title} component
              </button>
            </>
          )}
        </div>

        {status?.dev_mode && <p className="bootstrap-note">Dev mode: using the repository Python environment.</p>}
      </section>
    </div>
  );
}
