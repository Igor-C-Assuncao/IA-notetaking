import { useState, useEffect, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { GearIcon, ArrowsOutSimpleIcon, ArrowsInSimpleIcon, CopyIcon, ExportIcon, MagnifyingGlassIcon } from "@phosphor-icons/react";
import "./App.css";

interface Meeting {
  id: number;
  date: string;
  title: string;
  raw_transcript: string;
  markdown_summary: string;
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

// ── Settings modal ────────────────────────────────────────────
function SettingsModal({
  provider, setProvider, modelName, setModelName,
  apiKey, setApiKey, theme, setTheme,
  onSave, onCancel,
}: {
  provider: string; setProvider: (v: string) => void;
  modelName: string; setModelName: (v: string) => void;
  apiKey: string; setApiKey: (v: string) => void;
  theme: string; setTheme: (v: string) => void;
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
        <div className="modal-actions">
          <button className="btn-cancel" onClick={onCancel}>Cancel</button>
          <button className="btn-save" onClick={onSave}>Save Changes</button>
        </div>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────
function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Initializing system…");
  const [transcription, setTranscription] = useState("");
  const [notes, setNotes] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [activeTab, setActiveTab] = useState<"transcript" | "summary" | "actions">("transcript");
  const [search, setSearch] = useState("");

  const [meetingsHistory, setMeetingsHistory] = useState<Meeting[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<number | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [provider, setProvider] = useState("ollama");
  const [modelName, setModelName] = useState("llama3");
  const [apiKey, setApiKey] = useState("");
  const [theme, setTheme] = useState("liquid-glass");

  const isLG = theme !== "minimalist-notebook";
  const waveColor = isLG ? "rgba(255,255,255,0.92)" : "#1a1814";

  // Recording timer
  useEffect(() => {
    if (!isRecording) { setRecordingSeconds(0); return; }
    const id = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [isRecording]);

  // Derived data
  const actionItems = useMemo(() => (notes ? parseActionItems(notes) : []), [notes]);
  const tldr = useMemo(() => (notes ? parseTldr(notes) : null), [notes]);
  const filteredTranscript = useMemo(() => {
    if (!transcription || !search.trim()) return transcription;
    return transcription
      .split("\n")
      .filter((l) => l.toLowerCase().includes(search.toLowerCase()))
      .join("\n");
  }, [transcription, search]);

  // Load settings on mount
  useEffect(() => {
    const init = async () => {
      try {
        const store = await load("settings.json", { autoSave: false, defaults: {} });
        const sp = await store.get<string>("provider");
        const sm = await store.get<string>("modelName");
        const sk = await store.get<string>("apiKey");
        const st = await store.get<string>("theme");
        if (sp) setProvider(sp);
        if (sm) setModelName(sm);
        if (sk) setApiKey(sk);
        if (st) setTheme(st);
      } catch (e) {
        console.error("Failed to load settings:", e);
      }
    };
    init();
    loadHistory();
  }, []);

  const saveSettings = async () => {
    try {
      const store = await load("settings.json", { autoSave: false, defaults: {} });
      await store.set("provider", provider);
      await store.set("modelName", modelName);
      await store.set("apiKey", apiKey);
      await store.set("theme", theme);
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

  // Apply theme to root
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  // Python backend events
  useEffect(() => {
    const unlisten = listen<string>("python-event", async (event) => {
      try {
        const parsed = JSON.parse(event.payload);
        switch (parsed.event) {
          case "SYSTEM_READY":
            setStatus(parsed.data.status);
            break;
          case "RECORDING_STATUS":
            setIsRecording(parsed.data.is_recording);
            if (parsed.data.is_recording) {
              setTranscription("");
              setNotes("");
              setSelectedMeetingId(null);
              setActiveTab("transcript");
            }
            break;
          case "PIPELINE_STATUS":
            setStatus(parsed.data.step);
            break;
          case "TRANSCRIPTION_COMPLETED":
            setTranscription(parsed.data.text);
            setActiveTab("transcript");
            break;
          case "NOTES_GENERATED": {
            const md = parsed.data.markdown;
            setNotes(md);
            setActiveTab("summary");
            try {
              await invoke("save_meeting", {
                date: new Date().toLocaleString(),
                title: `Meeting ${new Date().toLocaleDateString()}`,
                rawTranscript: transcription,
                markdownSummary: md,
              });
              await loadHistory();
            } catch (dbErr) {
              console.error("DB save error:", dbErr);
            }
            break;
          }
          case "ERROR":
            setStatus(`Error: ${parsed.data.message}`);
            break;
        }
      } catch (e) {
        console.error("Event parse error:", e);
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, [transcription]);

  const toggleRecording = async () => {
    const action = isRecording ? "STOP_RECORDING" : "START_RECORDING";
    setIsRecording(!isRecording);
    setStatus(isRecording ? "Stopping…" : `Recording via ${provider.toUpperCase()}`);
    try {
      await invoke("send_command_to_python", {
        payload: JSON.stringify({ action, llm_provider: provider, llm_model: modelName, api_key: apiKey }),
      });
    } catch (e) {
      console.error("IPC error:", e);
      setStatus("Engine connection failed");
    }
  };

  const toggleWindowMode = async () => {
    try {
      if (isExpanded) {
        await invoke("set_compact_mode");
        setIsExpanded(false);
      } else {
        await invoke("set_expanded_mode");
        setIsExpanded(true);
      }
    } catch (e) {
      console.error("Window mode error:", e);
    }
  };

  const handleCopy = async () => {
    await writeText(notes);
    setStatus("Copied to clipboard!");
    setTimeout(() => setStatus("Ready"), 2000);
  };

  const handleExport = async () => {
    const path = await save({
      filters: [{ name: "Markdown", extensions: ["md"] }],
      defaultPath: `Notes_${Date.now()}.md`,
    });
    if (path) {
      await writeTextFile(path, notes);
      setStatus("Exported successfully");
    }
  };

  // ── COMPACT WIDGET ──────────────────────────────────────────
  if (!isExpanded) {
    return (
      <div className="compact-widget" data-tauri-drag-region>
        <div className="pill-inner">
          {/* Left */}
          <div className="pill-left" data-tauri-drag-region>
            <StatusDot isRecording={isRecording} size={8} isLG={isLG} />
            <LogoMark size={22} light={isLG} />
          </div>

          {/* Middle: waveform + timer */}
          <div className="pill-middle" data-tauri-drag-region>
            <Waveform width={140} height={20} color={waveColor} active={isRecording} bars={26} />
            <span className="timer-display">
              {isRecording ? formatDuration(recordingSeconds) : "--:--"}
            </span>
          </div>

          {/* Right: controls */}
          <div className="pill-right">
            <button className="icon-btn-pill" onClick={() => setShowSettings(true)} title="Settings">
              <GearIcon size={15} />
            </button>
            <button
              className={`record-btn-pill ${isRecording ? "recording" : ""}`}
              onClick={toggleRecording}
              title={isRecording ? "Stop Recording" : "Start Recording"}
            >
              {isRecording ? <span className="stop-square" /> : <span className="record-circle" />}
            </button>
            <button className="icon-btn-pill" onClick={toggleWindowMode} title="Expand">
              <ArrowsOutSimpleIcon size={14} />
            </button>
          </div>
        </div>

        {showSettings && (
          <SettingsModal
            provider={provider} setProvider={setProvider}
            modelName={modelName} setModelName={setModelName}
            apiKey={apiKey} setApiKey={setApiKey}
            theme={theme} setTheme={setTheme}
            onSave={saveSettings} onCancel={() => setShowSettings(false)}
          />
        )}
      </div>
    );
  }

  // ── EXPANDED VIEW ───────────────────────────────────────────
  return (
    <div className="app-layout">
      {/* Titlebar */}
      <div className="titlebar" data-tauri-drag-region>
        <div className="traffic-lights">
          <span className="tl tl-red" />
          <span className="tl tl-amber" />
          <span className="tl tl-green" />
        </div>
        <div className="titlebar-center">
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
        </div>
      </div>

      <div className="content-area">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-label">MEETINGS</div>

          {/* Current session */}
          <div className={`history-item current ${isRecording ? "recording" : ""}`}>
            <div className="history-item-header">
              <StatusDot isRecording={isRecording} size={6} isLG={isLG} />
              <span className="history-item-title">Current Session</span>
            </div>
            <span className="history-item-date">
              {isRecording ? `Recording · ${formatDuration(recordingSeconds)}` : status}
            </span>
          </div>

          {/* History */}
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

          {meetingsHistory.length === 0 && (
            <p className="empty-label">No past meetings</p>
          )}
        </aside>

        {/* Main */}
        <main className="main-content">
          {/* Meeting header */}
          <div className="meeting-header">
            <div className="meeting-header-left">
              <div className="meeting-title">
                {selectedMeetingId
                  ? meetingsHistory.find((m) => m.id === selectedMeetingId)?.title ?? "Meeting"
                  : "Current Session"}
              </div>
              <div className="meeting-meta">
                {isRecording
                  ? `Recording · ${formatDuration(recordingSeconds)}`
                  : status}
              </div>
            </div>
            <div className="meeting-header-right">
              {isRecording && (
                <Waveform width={60} height={14} color={waveColor} active bars={14} />
              )}
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

          {/* Tab bar */}
          <div className="tab-bar">
            <div className="tabs">
              {(["transcript", "summary", "actions"] as const).map((t) => (
                <button
                  key={t}
                  className={`tab-btn ${activeTab === t ? "active" : ""}`}
                  onClick={() => setActiveTab(t)}
                >
                  {t === "transcript" && "Transcript"}
                  {t === "summary" && "Summary"}
                  {t === "actions" && `Action Items${actionItems.length ? ` · ${actionItems.length}` : ""}`}
                </button>
              ))}
            </div>
            <div className="search-box">
              <MagnifyingGlassIcon size={12} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="search-input"
              />
            </div>
          </div>

          {/* Tab content */}
          <div className="tab-content">
            {/* Transcript */}
            {activeTab === "transcript" && (
              <div className="tab-panel">
                {filteredTranscript ? (
                  <pre className="transcript-text">{filteredTranscript}</pre>
                ) : (
                  <div className="empty-state">
                    {isRecording
                      ? <><Waveform width={60} height={14} color={waveColor} active bars={14} /><span>Transcribing…</span></>
                      : <span>Start recording to see the transcript here.</span>
                    }
                  </div>
                )}
              </div>
            )}

            {/* Summary */}
            {activeTab === "summary" && (
              <div className="tab-panel">
                {notes ? (
                  <>
                    {tldr && (
                      <div className="tldr-card">
                        <div className="tldr-label">TL;DR</div>
                        <p className="tldr-body">{tldr}</p>
                      </div>
                    )}
                    <pre className="summary-text">{notes}</pre>
                  </>
                ) : (
                  <div className="empty-state">
                    <span>Summary will appear here once recording is processed.</span>
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            {activeTab === "actions" && (
              <div className="tab-panel">
                {actionItems.length > 0 ? (
                  <ul className="action-list">
                    {actionItems.map((item, i) => (
                      <li key={i} className="action-item">
                        <span className="action-checkbox" />
                        <span className="action-text">{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="empty-state">
                    <span>
                      {notes
                        ? "No action items found. Use `- [ ] task` format in your prompts."
                        : "Action items will appear here after processing."}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer actions */}
          {notes && (
            <div className="footer-actions">
              <button className="chip-btn" onClick={handleCopy}>
                <CopyIcon size={13} /> Copy
              </button>
              <button className="chip-btn" onClick={handleExport}>
                <ExportIcon size={13} /> Export .MD
              </button>
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
          onSave={saveSettings} onCancel={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

export default App;
