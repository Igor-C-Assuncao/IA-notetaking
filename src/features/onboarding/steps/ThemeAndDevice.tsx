import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { WizardState } from "../OnboardingWizard";
import { invoke } from "@tauri-apps/api/core";
import { usePythonEvent } from "@app/providers/IpcProvider";
import { AudioDevice } from "@shared/types/ipc-events";

interface Props {
  state: WizardState;
  setState: Dispatch<SetStateAction<WizardState>>;
  onFinish: () => void;
  onPrev: () => void;
  isFinishing: boolean;
}

export function ThemeAndDevice({ state, setState, onFinish, onPrev, isFinishing }: Props) {
  const [level, setLevel] = useState(0);
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [testCountdown, setTestCountdown] = useState(0);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const testIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const testTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const testingRef = useRef(false);

  useEffect(() => {
    // Apply theme preview immediately
    document.documentElement.setAttribute("data-theme", state.theme);
  }, [state.theme]);

  // Listen to VAD telemetry for the meter using the robust central hook
  usePythonEvent("VAD_TELEMETRY", (data) => {
    setLevel(data.level || 0);
  });

  usePythonEvent("DEVICE_LIST", (data) => {
    const microphones = (data.devices || []).filter((device) => device.type === "mic");
    setDevices(microphones);
    if (state.selectedDeviceId === null && microphones.length > 0) {
      setState((current) => ({ ...current, selectedDeviceId: microphones[0].id }));
    }
  });

  useEffect(() => {
    invoke("request_audio_devices").catch(console.error);
    return () => {
      if (testIntervalRef.current) clearInterval(testIntervalRef.current);
      if (testTimeoutRef.current) clearTimeout(testTimeoutRef.current);
      if (testingRef.current) {
        invoke("send_command_to_python", {
          payload: JSON.stringify({ action: "STOP_RECORDING" }),
        }).catch(console.error);
      }
    };
  }, []);

  const startTest = async () => {
    if (isTestingMic) return;
    setIsTestingMic(true);
    testingRef.current = true;
    setTestCountdown(5);
    
    try {
      await invoke("send_command_to_python", {
        payload: JSON.stringify({
          action: "START_RECORDING",
          system_audio: false,
          device_id: state.selectedDeviceId,
          is_test: true,
        })
      });

      testIntervalRef.current = setInterval(() => {
        setTestCountdown((prev) => {
          if (prev <= 1) {
            if (testIntervalRef.current) clearInterval(testIntervalRef.current);
            testIntervalRef.current = null;
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      testTimeoutRef.current = setTimeout(async () => {
        testingRef.current = false;
        await invoke("send_command_to_python", {
          payload: JSON.stringify({ action: "STOP_RECORDING" })
        });
        setLevel(0);
        setIsTestingMic(false);
        testTimeoutRef.current = null;
      }, 5000);
    } catch (e) {
      console.error(e);
      testingRef.current = false;
      setIsTestingMic(false);
    }
  };

  return (
    <div className="wizard-step">
      <h3>Personalize & Test</h3>
      <p className="step-desc">Pick your flavor and make sure the mic hears you.</p>

      <div className="theme-row">
        <div 
          className={`theme-card ${state.theme === "liquid-glass" ? "active" : ""}`}
          onClick={() => setState(s => ({ ...s, theme: "liquid-glass" }))}
          style={{ background: "#100e18", color: "#fff", border: "1px solid rgba(255,255,255,0.18)" }}
        >
          <div className="theme-preview-lg">
             <div className="preview-dot" style={{background: "#ff5f57"}}></div>
             <div className="preview-dot" style={{background: "#febc2e"}}></div>
             <div className="preview-dot" style={{background: "#28c840"}}></div>
          </div>
          <h4>Liquid Glass</h4>
          <p>Dark, blurred, and native-feeling</p>
        </div>

        <div 
          className={`theme-card ${state.theme === "minimalist-notebook" ? "active" : ""}`}
          onClick={() => setState(s => ({ ...s, theme: "minimalist-notebook" }))}
          style={{ background: "#faf6ec", color: "#1a1814", border: "1.5px solid #1a1814" }}
        >
          <div className="theme-preview-nb">
             <div className="preview-line"></div>
             <div className="preview-line w-half"></div>
          </div>
          <h4>Notebook</h4>
          <p>Light, brutalist, and typographic</p>
        </div>
      </div>

      <div className="mic-test-box">
        <h4>Microphone Test</h4>
        <p className="mic-desc">Click test and speak. If the bar moves, you're good to go.</p>

        <label className="device-label" htmlFor="onboarding-microphone">Microphone</label>
        <select
          id="onboarding-microphone"
          className="device-select"
          value={state.selectedDeviceId ?? ""}
          onChange={(event) => setState((current) => ({
            ...current,
            selectedDeviceId: event.target.value ? Number(event.target.value) : null,
          }))}
          disabled={isTestingMic}
        >
          {devices.length === 0 && <option value="">Default microphone</option>}
          {devices.map((device) => (
            <option key={device.id} value={device.id}>{device.name}</option>
          ))}
        </select>
        
        <div className="meter-container">
          <div className="meter-bg">
            <div className="meter-fill" style={{ width: `${Math.min(100, level * 100)}%` }}></div>
          </div>
        </div>
        
        <button className="btn-secondary" onClick={startTest} disabled={isTestingMic}>
          {isTestingMic ? `Testing... (${testCountdown}s)` : "Test Mic (5s)"}
        </button>
      </div>

      <div className="wizard-footer">
        <button className="btn-secondary" onClick={onPrev}>Back</button>
        <button className="btn-primary" onClick={onFinish} disabled={isFinishing || isTestingMic}>
          {isFinishing ? "Saving..." : "Finish Setup"}
        </button>
      </div>

      <style>{`
        .wizard-step { display: flex; flex-direction: column; height: 100%; }
        h3 { font-size: 16px; margin-bottom: 8px; }
        .step-desc { font-size: 13px; color: var(--text-dim); margin-bottom: 24px; }

        .theme-row {
          display: flex; gap: 16px; margin-bottom: 24px;
        }
        
        .theme-card {
          flex: 1; border-radius: var(--radius-lg); padding: 20px; cursor: pointer;
          transition: transform 150ms, box-shadow 150ms;
        }
        .theme-card:hover { transform: translateY(-2px); }
        .theme-card.active { box-shadow: 0 0 0 2px var(--accent); }
        
        .theme-preview-lg {
          height: 60px; background: rgba(255,255,255,0.05); border-radius: 8px; margin-bottom: 12px;
          border: 1px solid rgba(255,255,255,0.1); display: flex; padding: 10px; gap: 6px;
        }
        .preview-dot { width: 10px; height: 10px; border-radius: 50%; }

        .theme-preview-nb {
          height: 60px; background: #fff; border-radius: 2px; margin-bottom: 12px;
          border: 1px solid #d0c8bc; padding: 12px; display: flex; flex-direction: column; gap: 6px;
        }
        .preview-line { height: 4px; background: #1a1814; border-radius: 2px; }
        .w-half { width: 50%; }

        .theme-card h4 { font-size: 14px; margin-bottom: 4px; font-weight: 600; }
        .theme-card p { font-size: 11px; opacity: 0.7; }

        .mic-test-box {
          background: var(--bg-panel); border: 1px solid var(--border);
          border-radius: var(--radius-lg); padding: 20px; flex: 1;
        }
        .mic-test-box h4 { font-size: 13px; margin-bottom: 4px; }
        .mic-desc { font-size: 12px; color: var(--text-dim); margin-bottom: 16px; }
        .device-label { display: block; font-size: 11px; color: var(--text-faint); margin-bottom: 6px; }
        .device-select {
          width: 100%; padding: 8px; margin-bottom: 16px; background: var(--bg-input);
          border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text);
        }

        .meter-container { margin-bottom: 16px; }
        .meter-bg { height: 8px; background: var(--bg-input); border-radius: 4px; overflow: hidden; }
        .meter-fill { height: 100%; background: var(--green); transition: width 50ms linear; }

        .btn-secondary {
          background: var(--bg-input); color: var(--text); border: 1px solid var(--border);
          padding: 6px 14px; border-radius: var(--radius-sm); font-size: 12px; cursor: pointer;
        }
        .btn-secondary:hover { background: var(--bg-hover); }

        .wizard-footer {
          display: flex; justify-content: space-between; align-items: center;
          margin-top: auto; padding-top: 16px; border-top: 1px solid var(--border);
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
