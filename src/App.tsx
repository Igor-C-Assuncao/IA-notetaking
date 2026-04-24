import { useState, useEffect, useMemo, useRef } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { load } from "@tauri-apps/plugin-store";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  GearIcon, ArrowsOutSimpleIcon, ArrowsInSimpleIcon,
  CopyIcon, ExportIcon, MagnifyingGlassIcon,
} from "@phosphor-icons/react";
import "./App.css";

interface Meeting {
  id: number;
  date: string;
  title: string;
  raw_transcript: string;
  markdown_summary: string;
}

interface SettingsPayload {
  provider: string;
  modelName: string;
  apiKey: string;
  theme: string;
  language: string;
  systemAudio: boolean;
  autoSummarize: boolean;
  speakerDiarization: boolean;
  alwaysOnTop: boolean;
}

// ── OS detection ──────────────────────────────────────────────
function detectOS(): "mac" | "win" {
  const p = (navigator.platform || "").toLowerCase();
  const ua = (navigator.userAgent || "").toLowerCase();
  if (p.startsWith("win") || ua.includes("windows")) return "win";
  return "mac";
}

// ── macOS Traffic Lights ──────────────────────────────────────
function MacTrafficLights({ theme }: { theme: string }) {
  const [hover, setHover] = useState(false);
  const win = getCurrentWindow();
  const isNB = theme === "minimalist-notebook";

  return (
    <div
      className="mac-traffic-lights"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        className="tl tl-red"
        onClick={() => win.close()}
        title="Close"
        style={{ border: isNB ? "1px solid #1a1814" : "0.5px solid rgba(0,0,0,0.2)" }}
      >
        {hover && (
          <svg width={8} height={8} viewBox="0 0 14 14" fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={1.6} strokeLinecap="round">
            <path d="M4 4l6 6M10 4l-6 6" />
          </svg>
        )}
      </button>
      <button
        className="tl tl-amber"
        onClick={() => win.minimize()}
        title="Minimize"
        style={{ border: isNB ? "1px solid #1a1814" : "0.5px solid rgba(0,0,0,0.2)" }}
      >
        {hover && (
          <svg width={8} height={8} viewBox="0 0 14 14" fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={1.6} strokeLinecap="round">
            <path d="M3 7h8" />
          </svg>
        )}
      </button>
      <button
        className="tl tl-green"
        onClick={() => win.toggleMaximize()}
        title="Maximize"
        style={{ border: isNB ? "1px solid #1a1814" : "0.5px solid rgba(0,0,0,0.2)" }}
      >
        {hover && (
          <svg width={8} height={8} viewBox="0 0 14 14" fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={1.6} strokeLinecap="round">
            <path d="M4 4h6v6" /><path d="M10 10H4V4" transform="rotate(180 7 7)" />
          </svg>
        )}
      </button>
    </div>
  );
}

// ── Windows Caption Buttons ───────────────────────────────────
function WinCaptionButtons({ isLG, compactExpand }: { isLG: boolean; compactExpand?: () => void }) {
  const win = getCurrentWindow();
  const fg = isLG ? "rgba(255,255,255,0.85)" : "#1a1814";
  const hoverBg = isLG ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.07)";

  return (
    <div className="win-caption-buttons">
      <WinBtn fg={fg} hoverBg={hoverBg} onClick={() => win.minimize()} title="Minimize">
        <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1}>
          <path d="M0 5h10" />
        </svg>
      </WinBtn>
      {/* In compact mode, the "maximize" button expands to the full view instead
          of the native maximize (which makes no sense on a 120px pill). */}
      <WinBtn
        fg={fg}
        hoverBg={hoverBg}
        onClick={compactExpand ?? (() => win.toggleMaximize())}
        title={compactExpand ? "Expand" : "Maximize"}
      >
        <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1}>
          <rect x="0.5" y="0.5" width="9" height="9" />
        </svg>
      </WinBtn>
      <WinBtn fg={fg} hoverBg="#e81123" hoverFg="#fff" onClick={() => win.close()} title="Close">
        <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1}>
          <path d="M0 0l10 10M10 0L0 10" />
        </svg>
      </WinBtn>
    </div>
  );
}

function WinBtn({
  children, fg, hoverBg, hoverFg, onClick, title,
}: {
  children: React.ReactNode; fg: string; hoverBg: string; hoverFg?: string;
  onClick: () => void; title?: string;
}) {
  const [h, setH] = useState(false);
  return (
    <button
      className="win-btn"
      title={title}
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        background: h ? hoverBg : "transparent",
        color: h && hoverFg ? hoverFg : fg,
      }}
    >
      {children}
    </button>
  );
}

// ── Waveform ──────────────────────────────────────────────────
function Waveform({
  bars = 24, color = "#fff", active = true, height = 22, width = 160, opacity = 0.9,
}: {
  bars?: number; color?: string; active?: boolean; height?: number; width?: number; opacity?: number;
}) {
  const seeds = useMemo(
    () =>
      Array.from({ length: bars }, (_, i) => ({
        h: 0.25 + ((Math.sin(i * 1.3) + Math.cos(i * 2.7)) * 0.5 + 0.5) * 0.75,
        d: (i * 53) % 900,
      })),
    [bars]
  );
  const gap = Math.max(1, width / bars / 3);
  return (
    <div style={{ display: "flex", alignItems: "center", gap, height, width, opacity: active ? opacity : 0.3, flexShrink: 0 }}>
      {seeds.map((s, i) => (
        <div
          key={i}
          style={{
            flex: 1, background: color, borderRadius: 99,
            height: `${s.h * 100}%`, minHeight: 2,
            animation: active ? `wf ${900 + (s.d % 600)}ms ease-in-out ${s.d}ms infinite alternate` : "none",
          }}
        />
      ))}
    </div>
  );
}

// ── Status dot ────────────────────────────────────────────────
function StatusDot({ isRecording, size = 8, isLG }: { isRecording: boolean; size?: number; isLG: boolean }) {
  const color = isRecording ? (isLG ? "#ff4d5f" : "#c03838") : (isLG ? "#30d158" : "#2d5a3d");
  return (
    <span style={{ position: "relative", display: "inline-flex", width: size, height: size, flexShrink: 0 }}>
      <span style={{
        position: "absolute", inset: 0, borderRadius: 99, background: color,
        boxShadow: isLG ? `0 0 8px ${color}` : "none",
      }} />
      {isRecording && (
        <span style={{
          position: "absolute", inset: -2, borderRadius: 99, background: color,
          opacity: 0.35, animation: "dotPulse 1.6s ease-in-out infinite",
        }} />
      )}
    </span>
  );
}

// ── Logo ──────────────────────────────────────────────────────
function LogoMark({ size = 24, light = false }: { size?: number; light?: boolean }) {
  return (
    <img
      src={light ? "/logo-mark-white.png" : "/logo-mark.png"}
      width={size} height={size}
      style={{ display: "inline-block", objectFit: "contain", userSelect: "none", flexShrink: 0 }}
      alt="Ai NoteTaking" draggable={false}
    />
  );
}

// ── Toggle switch ─────────────────────────────────────────────
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`toggle ${on ? "on" : ""}`}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
    >
      <span className="toggle-thumb" />
    </button>
  );
}

interface AudioDevice {
  id: number;
  name: string;
  type: "mic" | "loopback";
}

// ── Shortcuts Modal ───────────────────────────────────────────
const SHORTCUTS = [
  { keys: ["⌘", "⇧", "R"],  win: ["Ctrl", "⇧", "R"],  label: "Toggle recording" },
  { keys: ["⌘", "⇧", "P"],  win: ["Ctrl", "⇧", "P"],  label: "Pause / Resume" },
  { keys: ["⌘", "⇧", "E"],  win: ["Ctrl", "⇧", "E"],  label: "Expand / Collapse" },
  { keys: ["⌘", "⇧", ","],  win: ["Ctrl", "⇧", ","],  label: "Open settings" },
];

function ShortcutsModal({ onClose, isLG }: { onClose: () => void; isLG: boolean }) {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div
        className={`shortcuts-modal ${isLG ? "shortcuts-lg" : "shortcuts-nb"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcuts-header">
          <span className="shortcuts-title">Keyboard Shortcuts</span>
          <button className="shortcuts-close" onClick={onClose}>✕</button>
        </div>
        <div className="shortcuts-list">
          {SHORTCUTS.map((s, i) => (
            <div key={i} className="shortcut-row">
              <span className="shortcut-label">{s.label}</span>
              <span className="shortcut-keys">
                {(isMac ? s.keys : s.win).map((k, j) => (
                  <kbd key={j} className="shortcut-key">{k}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
        <div className="shortcuts-note">
          Global shortcuts work even when the app is not in focus.
        </div>
      </div>
    </div>
  );
}

// ── Popover Window Content ────────────────────────────────────
// Rendered when window label is "popover". Self-contained: loads settings
// from store, emits "settings-changed" on save, closes itself on blur.
function PopoverWindowContent() {
  const [provider, setProvider] = useState("ollama");
  const [modelName, setModelName] = useState("llama3");
  const [customModel, setCustomModel] = useState("");
  const [language, setLanguage] = useState("auto");
  const [apiKey, setApiKey] = useState("");
  const [theme, setTheme] = useState("liquid-glass");
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<number | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [systemAudio, setSystemAudio] = useState(false);
  const [autoSummarize, setAutoSummarize] = useState(true);
  const [speakerDiarization, setSpeakerDiarization] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const isLG = theme !== "minimalist-notebook";
  const win = getCurrentWindow();

  // Load current settings from store on mount
  useEffect(() => {
    const init = async () => {
      try {
        const store = await load("settings.json", { autoSave: false, defaults: {} });
        const sp = await store.get<string>("provider");
        const sm = await store.get<string>("modelName");
        const scm = await store.get<string>("customModel");
        const sl = await store.get<string>("language");
        const sk = await store.get<string>("apiKey");
        const st = await store.get<string>("theme");
        const sd = await store.get<number>("selectedDeviceId");
        const sa = await store.get<boolean>("systemAudio");
        const as_ = await store.get<boolean>("autoSummarize");
        const sd2 = await store.get<boolean>("speakerDiarization");
        const aot = await store.get<boolean>("alwaysOnTop");
        if (sp) setProvider(sp);
        if (sm) setModelName(sm);
        if (scm) setCustomModel(scm);
        if (sl) setLanguage(sl);
        if (sk) setApiKey(sk);
        if (st) setTheme(st);
        if (sd != null) setSelectedDevice(sd);
        if (sa != null) setSystemAudio(sa);
        if (as_ != null) setAutoSummarize(as_);
        if (sd2 != null) setSpeakerDiarization(sd2);
        if (aot != null) setAlwaysOnTop(aot);
      } catch (e) {
        console.error("Failed to load settings in popover:", e);
      }
    };
    init();
    // Request device list from Python
    invoke("request_audio_devices").catch(console.error);
  }, []);

  // Listen for DEVICE_LIST and VAD_TELEMETRY events from Python
  useEffect(() => {
    const unlisten = listen<string>("python-event", (event) => {
      try {
        const parsed = JSON.parse(event.payload);
        if (parsed.event === "DEVICE_LIST") {
          setDevices(parsed.data.devices ?? []);
        } else if (parsed.event === "VAD_TELEMETRY") {
          setAudioLevel(parsed.data.level ?? 0);
        }
      } catch {}
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // alwaysOnTop applies immediately — no need to wait for Save
  useEffect(() => {
    win.setAlwaysOnTop(alwaysOnTop).catch(console.error);
  }, [alwaysOnTop]);

  // Keep data-theme in sync for correct CSS variables
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Close on window blur (click outside the popover)
  // Delay slightly so the window has time to gain focus first
  useEffect(() => {
    let handler: (() => void) | null = null;
    const timer = setTimeout(() => {
      handler = () => win.close();
      window.addEventListener("blur", handler);
    }, 300);
    return () => {
      clearTimeout(timer);
      if (handler) window.removeEventListener("blur", handler);
    };
  }, []);

  const handleSave = async () => {
    try {
      const store = await load("settings.json", { autoSave: false, defaults: {} });
      const effectiveModel = customModel.trim() || modelName;
      await store.set("provider", provider);
      await store.set("modelName", effectiveModel);
      await store.set("customModel", customModel);
      await store.set("language", language);
      await store.set("apiKey", apiKey);
      await store.set("theme", theme);
      await store.set("systemAudio", systemAudio);
      await store.set("autoSummarize", autoSummarize);
      await store.set("speakerDiarization", speakerDiarization);
      await store.set("alwaysOnTop", alwaysOnTop);
      if (selectedDevice !== null) await store.set("selectedDeviceId", selectedDevice);
      await store.save();
      await emit("settings-changed", {
        provider, modelName: effectiveModel, apiKey, theme, language,
        systemAudio, autoSummarize, speakerDiarization, alwaysOnTop,
      } satisfies SettingsPayload);
      await win.close();
    } catch (e) {
      console.error("Failed to save settings from popover:", e);
    }
  };

  return (
    <div
      className={`popover-window ${isLG ? "popover-lg" : "popover-nb"}`}
    >
      {/* Drag handle — full width, outside scroll */}
      <div className="popover-drag-handle" data-tauri-drag-region />

      {/* Scrollable content */}
      <div className="popover-scroll-body">
        <div className="popover-label">SETTINGS</div>

      {/* Input device picker */}
      <div className="popover-row">
        <label className="popover-row-label">Input</label>
        <select
          className="popover-select"
          value={selectedDevice ?? ""}
          onChange={(e) => setSelectedDevice(Number(e.target.value))}
        >
          {devices.length === 0 && (
            <option value="">Loading devices…</option>
          )}
          {devices.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}{d.type === "loopback" ? " (loopback)" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Level meter — only visible while recording */}
      <div className="popover-level-meter">
        <div
          className="popover-level-bar"
          style={{ width: `${Math.round(audioLevel * 100)}%` }}
        />
      </div>

      {/* Provider */}
      <div className="popover-row">
        <label className="popover-row-label">Provider</label>
        <select
          className="popover-select"
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        >
          <option value="ollama">Ollama (Local)</option>
          <option value="openai">OpenAI</option>
          <option value="gemini">Gemini</option>
          <option value="anthropic">Anthropic</option>
        </select>
      </div>

      {/* Model + Language — two columns */}
      <div className="popover-row-dual">
        <div className="popover-col">
          <label className="popover-row-label">Model</label>
          <select
            className="popover-select"
            value={customModel ? "custom" : modelName}
            onChange={(e) => {
              if (e.target.value === "custom") {
                setModelName("custom");
              } else {
                setModelName(e.target.value);
                setCustomModel("");
              }
            }}
          >
            <optgroup label="Ollama">
              <option value="llama3">llama3</option>
              <option value="llama3.1">llama3.1</option>
              <option value="gemma3">gemma3</option>
              <option value="mistral">mistral</option>
              <option value="phi4">phi4</option>
            </optgroup>
            <optgroup label="OpenAI">
              <option value="gpt-4o">gpt-4o</option>
              <option value="gpt-4o-mini">gpt-4o-mini</option>
              <option value="gpt-4-turbo">gpt-4-turbo</option>
            </optgroup>
            <optgroup label="Anthropic">
              <option value="claude-sonnet-4-5">claude-sonnet-4-5</option>
              <option value="claude-haiku-4-5">claude-haiku-4-5</option>
            </optgroup>
            <optgroup label="Gemini">
              <option value="gemini-2.0-flash">gemini-2.0-flash</option>
              <option value="gemini-1.5-pro">gemini-1.5-pro</option>
            </optgroup>
            <option value="custom">Custom…</option>
          </select>
          {(modelName === "custom" || customModel) && (
            <input
              className="popover-input"
              type="text"
              placeholder="model-name"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              style={{ marginTop: 5 }}
            />
          )}
        </div>

        <div className="popover-col">
          <label className="popover-row-label">Language</label>
          <select
            className="popover-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
          >
            <option value="auto">Auto detect</option>
            <option value="pt">Português</option>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="fr">Français</option>
            <option value="de">Deutsch</option>
            <option value="it">Italiano</option>
            <option value="ja">日本語</option>
            <option value="zh">中文</option>
            <option value="ko">한국어</option>
            <option value="ru">Русский</option>
          </select>
        </div>
      </div>

      {/* API key */}
      {provider !== "ollama" && (
        <div className="popover-row">
          <label className="popover-row-label">API Key</label>
          <input
            className="popover-input"
            type="password"
            value={apiKey}
            placeholder="sk-…"
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
      )}

      {/* Behavior toggles */}
      <div className="popover-toggles-section">
        <div className="popover-toggle-row">
          <div>
            <div className="popover-toggle-label">System audio capture</div>
            <div className="popover-toggle-hint">Record the other side of calls</div>
          </div>
          <Toggle on={systemAudio} onChange={setSystemAudio} />
        </div>
        <div className="popover-toggle-row">
          <div>
            <div className="popover-toggle-label">Auto-summarize</div>
            <div className="popover-toggle-hint">Generate notes after recording stops</div>
          </div>
          <Toggle on={autoSummarize} onChange={setAutoSummarize} />
        </div>
        <div className="popover-toggle-row">
          <div>
            <div className="popover-toggle-label">Speaker diarization</div>
            <div className="popover-toggle-hint">Identify who said what</div>
          </div>
          <Toggle on={speakerDiarization} onChange={setSpeakerDiarization} />
        </div>
        <div className="popover-toggle-row">
          <div>
            <div className="popover-toggle-label">Always on top</div>
            <div className="popover-toggle-hint">Keep widget above other windows</div>
          </div>
          <Toggle on={alwaysOnTop} onChange={setAlwaysOnTop} />
        </div>
        <div className="popover-toggle-row">
          <div>
            <div className="popover-toggle-label">Notebook theme</div>
            <div className="popover-toggle-hint">Switch to light / paper style</div>
          </div>
          <Toggle
            on={theme === "minimalist-notebook"}
            onChange={(v) => setTheme(v ? "minimalist-notebook" : "liquid-glass")}
          />
        </div>
      </div>

      </div>{/* end popover-scroll-body */}

      {/* Footer — pinned at bottom */}
      <div className="popover-footer-bar">
        <div className="popover-footer-left">
          <button
            className="popover-text-btn"
            onClick={async () => {
              await handleSave();
              await invoke("set_expanded_mode");
            }}
          >
            Preferences…
          </button>
          <span className="popover-footer-sep" />
          <button
            className="popover-text-btn"
            onClick={() => setShowShortcuts(true)}
          >
            Shortcuts
          </button>
        </div>
        <button className="popover-btn primary" onClick={handleSave}>Save</button>
      </div>

      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} isLG={isLG} />}
    </div>
  );
}

// ── Full settings modal (expanded mode) ───────────────────────
function SettingsModal({
  provider, setProvider, modelName, setModelName,
  apiKey, setApiKey, theme, setTheme,
  systemPrompt, setSystemPrompt,
  onSave, onCancel,
}: {
  provider: string; setProvider: (v: string) => void;
  modelName: string; setModelName: (v: string) => void;
  apiKey: string; setApiKey: (v: string) => void;
  theme: string; setTheme: (v: string) => void;
  systemPrompt: string; setSystemPrompt: (v: string) => void;
  onSave: () => void; onCancel: () => void;
}) {
  return (
    <div className="modal-overlay">
      <div className="settings-modal">
        <h3>IA Configuration</h3>
        <div className="form-group">
          <label>Theme</label>
          <select value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="liquid-glass">Liquid Glass (Dark)</option>
            <option value="minimalist-notebook">Notebook Paper (Light)</option>
          </select>
        </div>
        <div className="form-group">
          <label>LLM Provider</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="ollama">Ollama (Local)</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Google Gemini</option>
            <option value="anthropic">Anthropic Claude</option>
          </select>
        </div>
        <div className="form-group">
          <label>Model Name</label>
          <input type="text" value={modelName} onChange={(e) => setModelName(e.target.value)} />
        </div>
        {provider !== "ollama" && (
          <div className="form-group">
            <label>API Key</label>
            <input type="password" value={apiKey} placeholder="Enter your key…" onChange={(e) => setApiKey(e.target.value)} />
          </div>
        )}
        <div className="form-group">
          <label>Custom System Prompt <span className="form-hint">Optional — guides the AI output style</span></label>
          <textarea
            className="system-prompt-textarea"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder={"Examples:\n• Bullet points only\n• Focus on action items\n• Translate output to Portuguese\n• Keep summary under 200 words"}
            rows={4}
          />
        </div>
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onCancel}>Cancel</button>
          <button className="btn-save" onClick={onSave}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

// ── Parse helpers ─────────────────────────────────────────────
function parseActionItems(md: string): string[] {
  return md
    .split("\n")
    .filter((l) => /^[\-\*]\s*\[\s*\]/.test(l.trim()))
    .map((l) => l.replace(/^[\-\*]\s*\[\s*\]\s*/, "").trim())
    .filter(Boolean);
}

function parseTldr(md: string): string | null {
  const m = md.match(/##\s*tl[;:]?dr\s*\n+([\s\S]*?)(?=\n##|$)/i);
  return m ? m[1].trim() : null;
}

function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0)
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// ── App (main window) ─────────────────────────────────────────
function App() {
  const os = useMemo(detectOS, []);
  const isWin = os === "win";

  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Initializing system…");
  const [transcription, setTranscription] = useState("");
  const [notes, setNotes] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioLevel, setAudioLevel] = useState(0);
  const [activeTab, setActiveTab] = useState<"transcript" | "summary" | "actions">("transcript");
  const [search, setSearch] = useState("");

  const [meetingsHistory, setMeetingsHistory] = useState<Meeting[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<number | null>(null);

  const [showSettings, setShowSettings] = useState(false);

  const [provider, setProvider] = useState("ollama");
  const [modelName, setModelName] = useState("llama3");
  const [apiKey, setApiKey] = useState("");
  const [theme, setTheme] = useState("liquid-glass");
  const [language, setLanguage] = useState("auto");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [systemAudio, setSystemAudio] = useState(false);
  const [autoSummarize, setAutoSummarize] = useState(true);
  const [speakerDiarization, setSpeakerDiarization] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);

  const isLG = theme !== "minimalist-notebook";
  const waveColor = isLG ? "rgba(255,255,255,0.92)" : "#1a1814";

  // Recording timer
  useEffect(() => {
    if (!isRecording) { setRecordingSeconds(0); return; }
    const id = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [isRecording]);

  const actionItems = useMemo(() => (notes ? parseActionItems(notes) : []), [notes]);
  const tldr = useMemo(() => (notes ? parseTldr(notes) : null), [notes]);
  const filteredTranscript = useMemo(() => {
    if (!transcription || !search.trim()) return transcription;
    return transcription
      .split("\n")
      .filter((l) => l.toLowerCase().includes(search.toLowerCase()))
      .join("\n");
  }, [transcription, search]);

  // Load persisted settings and history on mount
  useEffect(() => {
    const init = async () => {
      try {
        const store = await load("settings.json", { autoSave: false, defaults: {} });
        const sp = await store.get<string>("provider");
        const sm = await store.get<string>("modelName");
        const sk = await store.get<string>("apiKey");
        const st = await store.get<string>("theme");
        const ssp = await store.get<string>("systemPrompt");
        if (sp) setProvider(sp);
        if (sm) setModelName(sm);
        if (sk) setApiKey(sk);
        if (st) setTheme(st);
        if (ssp) setSystemPrompt(ssp);
      } catch (e) {
        console.error("Failed to load settings:", e);
      }
    };
    init();
    loadHistory();
  }, []);

  // Listen for settings saved from the popover window
  useEffect(() => {
    const unlisten = listen<SettingsPayload>("settings-changed", (event) => {
      const { provider: p, modelName: m, apiKey: k, theme: t,
              language: l,
              systemAudio: sa, autoSummarize: as_, speakerDiarization: sd, alwaysOnTop: aot } = event.payload;
      setProvider(p);
      setModelName(m);
      setApiKey(k);
      setTheme(t);
      setLanguage(l);
      setSystemAudio(sa);
      setAutoSummarize(as_);
      setSpeakerDiarization(sd);
      setAlwaysOnTop(aot);
      setStatus("Settings saved");
      setTimeout(() => setStatus("Ready"), 2000);
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  const saveSettings = async () => {
    try {
      const store = await load("settings.json", { autoSave: false, defaults: {} });
      await store.set("provider", provider);
      await store.set("modelName", modelName);
      await store.set("apiKey", apiKey);
      await store.set("theme", theme);
      await store.set("systemPrompt", systemPrompt);
      await store.save();
      setShowSettings(false);
      setStatus("Settings saved");
    } catch (e) {
      console.error("Failed to save settings:", e);
    }
  };

  const loadHistory = async () => {
    try {
      const meetings: Meeting[] = await invoke("get_meetings");
      setMeetingsHistory(meetings);
    } catch (e) {
      console.error("DB fetch error:", e);
    }
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const unlisten = listen<string>("python-event", async (event) => {
      try {
        const parsed = JSON.parse(event.payload);
        switch (parsed.event) {
          case "SYSTEM_READY": setStatus(parsed.data.status); break;
          case "VAD_TELEMETRY":
            setAudioLevel(parsed.data.level ?? 0);
            break;
          case "RECORDING_STATUS":
            setIsRecording(parsed.data.is_recording);
            if (parsed.data.is_recording) {
              setTranscription(""); setNotes(""); setSelectedMeetingId(null); setActiveTab("transcript");
            }
            break;
          case "PIPELINE_STATUS": setStatus(parsed.data.step); break;
          case "TRANSCRIPTION_COMPLETED":
            setTranscription(parsed.data.text); setActiveTab("transcript"); break;
          case "NOTES_GENERATED": {
            const md = parsed.data.markdown;
            setNotes(md); setActiveTab("summary");
            try {
              await invoke("save_meeting", {
                date: new Date().toLocaleString(),
                title: `Meeting ${new Date().toLocaleDateString()}`,
                rawTranscript: transcription, markdownSummary: md,
              });
              await loadHistory();
            } catch (dbErr) { console.error("DB save error:", dbErr); }
            break;
          }
          case "ERROR": setStatus(`Error: ${parsed.data.message}`); break;
        }
      } catch (e) { console.error("Event parse error:", e); }
    });
    return () => { unlisten.then((f) => f()); };
  }, [transcription]);

  const toggleRecording = async () => {
    const action = isRecording ? "STOP_RECORDING" : "START_RECORDING";
    setIsRecording(!isRecording);
    setStatus(isRecording ? "Stopping…" : `Recording via ${provider.toUpperCase()}`);
    try {
      await invoke("send_command_to_python", {
        payload: JSON.stringify({
          action,
          llm_provider: provider,
          llm_model: modelName,
          api_key: apiKey,
          language,
          system_audio: systemAudio,
          auto_summarize: autoSummarize,
          speaker_diarization: speakerDiarization,
          system_prompt: systemPrompt,
        }),
      });
    } catch (e) {
      console.error("IPC error:", e); setStatus("Engine connection failed");
    }
  };

  const toggleWindowMode = async () => {
    try {
      if (isExpanded) { await invoke("set_compact_mode"); setIsExpanded(false); }
      else { await invoke("set_expanded_mode"); setIsExpanded(true); }
    } catch (e) { console.error("Window mode error:", e); }
  };

  const handleCopy = async () => {
    await writeText(notes);
    setStatus("Copied to clipboard!");
    setTimeout(() => setStatus("Ready"), 2000);
  };

  const handleExport = async () => {
    const path = await save({ filters: [{ name: "Markdown", extensions: ["md"] }], defaultPath: `Notes_${Date.now()}.md` });
    if (path) { await writeTextFile(path, notes); setStatus("Exported successfully"); }
  };

  // ── COMPACT WIDGET ──────────────────────────────────────────
  if (!isExpanded) {
    return (
      <div className={`compact-widget ${isWin ? "win" : "mac"}`}>
        {/* OS titlebar strip — drag region spans the full strip */}
        <div className="compact-os-strip" data-tauri-drag-region>
          {!isWin && <MacTrafficLights theme={theme} />}
          <div className="compact-os-title" data-tauri-drag-region>
            <LogoMark size={12} light={isLG} />
            <span>Ai NoteTaking</span>
          </div>
          {/* On Windows, the "maximize" button expands to full view */}
          {isWin && <WinCaptionButtons isLG={isLG} compactExpand={toggleWindowMode} />}
        </div>

        {/* Content row */}
        <div className="pill-inner">
          <div className="pill-left" data-tauri-drag-region>
            <StatusDot isRecording={isRecording} size={8} isLG={isLG} />
          </div>

          <div className="pill-middle" data-tauri-drag-region>
            <Waveform width={150} height={20} color={waveColor} active={isRecording} bars={28} />
            <span className="timer-display">
              {isRecording ? formatDuration(recordingSeconds) : "--:--"}
            </span>
          </div>

          <div className="pill-right">
            {/* Gear opens the popover as a separate OS window */}
            <button
              className="icon-btn-pill"
              onClick={() => invoke("open_popover_window")}
              title="Settings"
            >
              <GearIcon size={15} />
            </button>
            <button
              className={`record-btn-pill ${isRecording ? "recording" : ""}`}
              onClick={toggleRecording}
              title={isRecording ? "Stop Recording" : "Start Recording"}
              style={isRecording ? { transform: `scale(${1 + audioLevel * 0.12})`, transition: "transform 80ms ease-out" } : undefined}
            >
              {isRecording ? <span className="stop-square" /> : <span className="record-circle" />}
            </button>
            <button className="icon-btn-pill" onClick={toggleWindowMode} title="Expand">
              <ArrowsOutSimpleIcon size={14} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── EXPANDED VIEW ───────────────────────────────────────────
  return (
    <div className={`app-layout ${isWin ? "win" : "mac"}`}>
      {/* OS titlebar */}
      <div className={`titlebar ${isWin ? "win" : "mac"}`} data-tauri-drag-region>
        {!isWin && <MacTrafficLights theme={theme} />}

        <div className="titlebar-center" data-tauri-drag-region>
          <LogoMark size={18} light={isLG} />
          <span className="titlebar-name">
            Ai<span className="titlebar-sub"> NoteTaking</span>
          </span>
        </div>

        <div className="titlebar-actions">
          <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings">
            <GearIcon size={16} />
          </button>
          <button className="icon-btn" onClick={toggleWindowMode} title="Collapse">
            <ArrowsInSimpleIcon size={16} />
          </button>
          {isWin && <WinCaptionButtons isLG={isLG} />}
        </div>
      </div>

      <div className="content-area">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-label">MEETINGS</div>
          <div className={`history-item current ${isRecording ? "recording" : ""}`}>
            <div className="history-item-header">
              <StatusDot isRecording={isRecording} size={6} isLG={isLG} />
              <span className="history-item-title">Current Session</span>
            </div>
            <span className="history-item-date">
              {isRecording ? `Recording · ${formatDuration(recordingSeconds)}` : status}
            </span>
          </div>
          {meetingsHistory.map((m) => (
            <button
              key={m.id}
              className={`history-item ${selectedMeetingId === m.id ? "active" : ""}`}
              onClick={() => {
                setSelectedMeetingId(m.id);
                setTranscription(m.raw_transcript);
                setNotes(m.markdown_summary);
                setActiveTab("transcript");
              }}
            >
              <span className="history-item-title">{m.title}</span>
              <span className="history-item-date">{m.date}</span>
            </button>
          ))}
          {meetingsHistory.length === 0 && <p className="empty-label">No past meetings</p>}
        </aside>

        {/* Main */}
        <main className="main-content">
          <div className="meeting-header">
            <div className="meeting-header-left">
              <div className="meeting-title">
                {selectedMeetingId
                  ? meetingsHistory.find((m) => m.id === selectedMeetingId)?.title ?? "Meeting"
                  : "Current Session"}
              </div>
              <div className="meeting-meta">
                {isRecording ? `Recording · ${formatDuration(recordingSeconds)}` : status}
              </div>
            </div>
            <div className="meeting-header-right">
              {isRecording && <Waveform width={60} height={14} color={waveColor} active bars={14} />}
              <button
                className={`record-btn-expanded ${isRecording ? "recording" : ""}`}
                onClick={toggleRecording}
                disabled={selectedMeetingId !== null && !isRecording}
              >
                {isRecording ? <span className="stop-square-sm" /> : <span className="record-circle-sm" />}
                {isRecording ? "Stop" : selectedMeetingId ? "New Session" : "Record"}
              </button>
            </div>
          </div>

          <div className="tab-bar">
            <div className="tabs">
              {(["transcript", "summary", "actions"] as const).map((t) => (
                <button key={t} className={`tab-btn ${activeTab === t ? "active" : ""}`} onClick={() => setActiveTab(t)}>
                  {t === "transcript" && "Transcript"}
                  {t === "summary" && "Summary"}
                  {t === "actions" && `Action Items${actionItems.length ? ` · ${actionItems.length}` : ""}`}
                </button>
              ))}
            </div>
            <div className="search-box">
              <MagnifyingGlassIcon size={12} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="search-input" />
            </div>
          </div>

          <div className="tab-content">
            {activeTab === "transcript" && (
              <div className="tab-panel">
                {filteredTranscript
                  ? <pre className="transcript-text">{filteredTranscript}</pre>
                  : <div className="empty-state">
                    {isRecording
                      ? <><Waveform width={60} height={14} color={waveColor} active bars={14} /><span>Transcribing…</span></>
                      : <span>Start recording to see the transcript here.</span>}
                  </div>}
              </div>
            )}
            {activeTab === "summary" && (
              <div className="tab-panel">
                {notes
                  ? <>{tldr && <div className="tldr-card"><div className="tldr-label">TL;DR</div><p className="tldr-body">{tldr}</p></div>}<pre className="summary-text">{notes}</pre></>
                  : <div className="empty-state"><span>Summary will appear here once recording is processed.</span></div>}
              </div>
            )}
            {activeTab === "actions" && (
              <div className="tab-panel">
                {actionItems.length > 0
                  ? <ul className="action-list">{actionItems.map((item, i) => (
                    <li key={i} className="action-item"><span className="action-checkbox" /><span className="action-text">{item}</span></li>
                  ))}</ul>
                  : <div className="empty-state"><span>{notes ? "No action items found. Use `- [ ] task` format." : "Action items will appear here after processing."}</span></div>}
              </div>
            )}
          </div>

          {notes && (
            <div className="footer-actions">
              <button className="chip-btn" onClick={handleCopy}><CopyIcon size={13} /> Copy</button>
              <button className="chip-btn" onClick={handleExport}><ExportIcon size={13} /> Export .MD</button>
            </div>
          )}
        </main>
      </div>

      {showSettings && (
        <SettingsModal
          provider={provider} setProvider={setProvider}
          modelName={modelName} setModelName={setModelName}
          apiKey={apiKey} setApiKey={setApiKey}
          theme={theme} setTheme={setTheme}
          systemPrompt={systemPrompt} setSystemPrompt={setSystemPrompt}
          onSave={saveSettings} onCancel={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

// ── Root — dispatches to PopoverWindowContent or App ──────────
// Using the window label (set in Rust via WebviewWindowBuilder) avoids
// any URL-parsing fragility and works identically in dev and production.
function Root() {
  const isPopover = getCurrentWindow().label === "popover";
  if (isPopover) return <PopoverWindowContent />;
  return <App />;
}

export default Root;