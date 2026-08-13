// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { ReactNode, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSettings } from "@app/providers/SettingsProvider";
import { usePythonEvent } from "@app/providers/IpcProvider";

type EngineKind = "cpu" | "gpu";
type BootstrapPhase = "checking" | "choose" | "downloading" | "starting" | "ready" | "error";
type BootstrapTaskState = "done" | "active" | "pending" | "error";
type BootstrapVariant = "setup" | "initializing";

interface EngineStatus {
  installed: boolean;
  kind: EngineKind;
  version: string;
  path?: string | null;
  size_bytes?: number | null;
  dev_mode: boolean;
  download_supported: boolean;
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

// React StrictMode mounts effects twice in dev; without this guard the boot
// effect would invoke start_sidecar twice and spawn duplicate supervisors.
let bootstrapEffectRan = false;

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

function buildBootstrapTasks(
  variant: BootstrapVariant,
  phase: BootstrapPhase,
  downloadStage: string | undefined,
  message: string,
  startupSlow: boolean,
  hasError: boolean,
) {
  const isVerifying = downloadStage === "verifying";
  const isLoadingModels = phase === "starting" && (startupSlow || message.toLowerCase().includes("loading local models"));
  const stateForSetup = (id: "check" | "download" | "verify" | "start"): BootstrapTaskState => {
    if (hasError && phase === "error") return id === "start" ? "error" : "done";
    if (phase === "checking" || phase === "choose") return id === "check" ? "active" : "pending";
    if (phase === "downloading") {
      if (id === "check") return "done";
      if (id === "download") return isVerifying ? "done" : "active";
      if (id === "verify") return isVerifying ? "active" : "pending";
      return "pending";
    }
    if (phase === "starting") return id === "start" ? "active" : "done";
    if (phase === "ready") return "done";
    return "pending";
  };

  const stateForInitializing = (id: "check" | "start" | "load"): BootstrapTaskState => {
    if (hasError && phase === "error") return id === "start" ? "error" : id === "check" ? "done" : "pending";
    if (phase === "checking") return id === "check" ? "active" : "pending";
    if (phase === "starting") {
      if (id === "check") return "done";
      if (id === "start") return isLoadingModels ? "done" : "active";
      return isLoadingModels ? "active" : "pending";
    }
    if (phase === "ready") return "done";
    return "pending";
  };

  if (variant === "setup") {
    return [
      { id: "check", label: "Check component", detail: "Looking for the local transcription component.", state: stateForSetup("check") },
      { id: "download", label: "Download", detail: "Downloading the selected transcription package.", state: stateForSetup("download") },
      { id: "verify", label: "Verify", detail: "Checking the package before startup.", state: stateForSetup("verify") },
      { id: "start", label: "Start services", detail: "Starting the local transcription services.", state: stateForSetup("start") },
    ];
  }

  return [
    { id: "check", label: "Check component", detail: "Confirming the local transcription component is available.", state: stateForInitializing("check") },
    { id: "start", label: "Start services", detail: "Starting the local transcription services.", state: stateForInitializing("start") },
    { id: "load", label: "Load models", detail: startupSlow ? "First launch can take a few minutes." : "Preparing transcription models.", state: stateForInitializing("load") },
  ];
}

export function EngineBootstrap({ children }: { children: ReactNode }) {
  const { settings, updateSettings } = useSettings();
  const win = getCurrentWindow();
  const isLightTheme = settings.theme === "minimalist-notebook";
  const [engineKind, setEngineKind] = useState<EngineKind>(settings.engineKind || "cpu");
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [phase, setPhase] = useState<BootstrapPhase>("checking");
  const [progress, setProgress] = useState<ProgressPayload | null>(null);
  const [message, setMessage] = useState("Checking the local transcription component...");
  const [error, setError] = useState("");
  const [startupSlow, setStartupSlow] = useState(false);

  const progressPct = useMemo(() => {
    if (!progress?.totalBytes) return 0;
    return Math.min(100, Math.round((progress.downloadedBytes / progress.totalBytes) * 100));
  }, [progress]);

  const downloadSupported = status?.download_supported ?? true;
  const bootstrapVariant: BootstrapVariant =
    (status?.installed === false && downloadSupported) || phase === "downloading" ? "setup" : "initializing";

  const bootstrapTasks = useMemo(
    () => buildBootstrapTasks(bootstrapVariant, phase, progress?.stage, message, startupSlow, Boolean(error)),
    [bootstrapVariant, phase, progress?.stage, message, startupSlow, error]
  );

  const activeTaskDetail = bootstrapTasks.find((task) => task.state === "active" || task.state === "error")?.detail;

  usePythonEvent("SYSTEM_READY", () => {
    setMessage("Local services started. Preparing audio capture...");
  });

  usePythonEvent("ENGINE_STATE", (data) => {
    setMessage(data.message);
    if (data.phase === "audio_ready" || data.phase === "model_loading" || data.phase === "transcription_ready") {
      setPhase("ready");
    }
    if (data.phase === "failed") {
      setError(data.message || "The local transcription component could not start.");
      setPhase("error");
    }
  });

  usePythonEvent("PREFLIGHT_RESULT", () => {
    if (settings.onboarding_completed) {
      invoke("set_compact_mode").catch(console.error).finally(() => setPhase("ready"));
    } else {
      setPhase("ready");
    }
  });

  usePythonEvent("SIDECAR_FAILED", () => {
    setError(
      downloadSupported
        ? "The local transcription component could not start. Try again or switch to CPU."
        : "The transcription component included with this installation could not start. Try again or reinstall the application."
    );
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
    if (bootstrapEffectRan) return;
    bootstrapEffectRan = true;
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
        if (nextStatus.download_supported) {
          setPhase("choose");
          setMessage("Choose how local transcription should run on this computer.");
        } else {
          setError("The transcription component included with this installation was not found. Reinstall the application and try again.");
          setPhase("error");
        }
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
      // Do not hold the whole desktop shell behind WhisperX. The Python
      // engine emits ENGINE_STATE once audio capture is ready.
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
            <span className="bootstrap-kicker">{bootstrapVariant === "setup" ? "First-time setup" : "Initializing services"}</span>
            <div className="topbar-actions">
              <button className="theme-toggle-btn" type="button" onClick={toggleTheme}>
                {isLightTheme ? "Dark theme" : "Light theme"}
              </button>
              <button className="topbar-close-btn" type="button" onClick={closeWindow} aria-label="Close">
                ×
              </button>
            </div>
          </div>
          <h1>{bootstrapVariant === "setup" ? "AI NoteTaking" : "Starting AI NoteTaking"}</h1>
          <p>{bootstrapVariant === "setup" ? "First we prepare the local transcription component. Later you can choose whether note generation uses local AI or a cloud API." : "Starting local transcription services before opening the app."}</p>
        </div>

        {bootstrapVariant === "setup" && (phase === "choose" || phase === "error") && (
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

        <div className="bootstrap-task-list" aria-label="Setup progress">
          {bootstrapTasks.map((task) => (
            <div key={task.id} className={`bootstrap-task ${task.state}`}>
              <span className="bootstrap-task-marker" aria-hidden="true">
                {task.state === "done" ? "✓" : task.state === "error" ? "!" : task.state === "active" ? "..." : ""}
              </span>
              <div>
                <strong>{task.label}</strong>
                {(task.state === "active" || task.state === "error") && <p>{task.detail}</p>}
              </div>
            </div>
          ))}
        </div>

        {(phase === "checking" || phase === "starting") && (
          <div className="bootstrap-status">
            <span className="spinner" />
            <div>
              <strong>{phase === "starting" ? "Starting services" : bootstrapVariant === "setup" ? "Checking installation" : "Checking services"}</strong>
              <p>{activeTaskDetail || message}</p>
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
          {bootstrapVariant === "setup" && (phase === "choose" || phase === "error") && (
            <>
              <button className="btn-secondary" type="button" onClick={() => checkEngine(engineKind)}>
                Check again
              </button>
              <button className="btn-primary" type="button" onClick={downloadSelectedEngine}>
                Download {ENGINE_COPY[engineKind].title} component
              </button>
            </>
          )}
          {bootstrapVariant === "initializing" && phase === "error" && (
            <button className="btn-secondary" type="button" onClick={() => checkEngine(engineKind)}>
              Retry startup
            </button>
          )}
        </div>

        {status?.dev_mode && <p className="bootstrap-note">Dev mode: using the repository Python environment.</p>}
      </section>
    </div>
  );
}
