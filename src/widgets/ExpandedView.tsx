import { useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { GearIcon, ArrowsInSimpleIcon, MagnifyingGlassIcon, CopyIcon, ExportIcon } from "@phosphor-icons/react";
import { MacTrafficLights } from "@features/window-chrome/MacTrafficLights";
import { WinCaptionButtons } from "@features/window-chrome/WinCaptionButtons";
import { StatusDot } from "@shared/ui/StatusDot";
import { Waveform } from "@shared/ui/Waveform";
import { LogoMark } from "@shared/ui/LogoMark";
import { formatDuration } from "@shared/lib/formatDuration";
import { detectOS } from "@shared/lib/detectOS";
import { useSettings } from "@app/providers/SettingsProvider";
import { useTheme } from "@app/providers/ThemeProvider";
import { useRecording } from "@features/recording/hooks/useRecording";
import { useTranscription } from "@features/transcription/hooks/useTranscription";
import { useSummary } from "@features/summary/hooks/useSummary";
import { useMeetings } from "@features/meetings/hooks/useMeetings";
import { SettingsModal } from "@features/settings/SettingsModal";

export function ExpandedView({
  isTransitioning, toggleWindowMode
}: {
  isTransitioning: boolean; toggleWindowMode: () => void;
}) {
  const { settings } = useSettings();
  const { isLG, waveColor } = useTheme();
  const { isRecording, recordingSeconds, status, toggleRecording } = useRecording();
  const { setTranscriptionText, search, setSearch, filteredTranscript } = useTranscription();
  const { notes, setNotesText, tldr, actionItems } = useSummary();
  const { meetingsHistory, selectedMeetingId, setSelectedMeetingId, sidebarSearch, setSidebarSearch } = useMeetings();
  
  const [activeTab, setActiveTab] = useState<"transcript" | "summary" | "actions">("transcript");
  const [showSettings, setShowSettings] = useState(false);

  const isWin = detectOS() === "win";

  const handleCopy = async () => {
    await writeText(notes);
  };

  const handleExport = async () => {
    const path = await save({ filters: [{ name: "Markdown", extensions: ["md"] }], defaultPath: `Notes_${Date.now()}.md` });
    if (path) { await writeTextFile(path, notes); }
  };

  return (
    <div className={`app-layout ${isWin ? "win" : "mac"} ${isTransitioning ? "transitioning" : "entered"}`}>
      <div className={`titlebar ${isWin ? "win" : "mac"}`} data-tauri-drag-region>
        {!isWin && <MacTrafficLights theme={settings.theme} />}
        <div className="titlebar-center" data-tauri-drag-region>
          <LogoMark size={18} light={isLG} />
          <span className="titlebar-name">Ai<span className="titlebar-sub"> NoteTaking</span></span>
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
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="sidebar-label">MEETINGS</div>
            <div className="sidebar-search-box">
              <MagnifyingGlassIcon size={11} />
              <input
                className="sidebar-search-input"
                value={sidebarSearch}
                onChange={(e) => setSidebarSearch(e.target.value)}
                placeholder="Search meetings…"
              />
            </div>
          </div>
          {!sidebarSearch && (
            <div className={`history-item current ${isRecording ? "recording" : ""}`}>
              <div className="history-item-header">
                <StatusDot isRecording={isRecording} size={6} isLG={isLG} />
                <span className="history-item-title">Current Session</span>
              </div>
              <span className="history-item-date">
                {isRecording ? `Recording · ${formatDuration(recordingSeconds)}` : status}
              </span>
            </div>
          )}
          {meetingsHistory.map((m) => (
            <button
              key={m.id}
              className={`history-item ${selectedMeetingId === m.id ? "active" : ""}`}
              onClick={() => {
                setSelectedMeetingId(m.id);
                if (setTranscriptionText) setTranscriptionText(m.raw_transcript);
                if (setNotesText) setNotesText(m.markdown_summary);
                setActiveTab("transcript");
              }}
            >
              <span className="history-item-title">{m.title}</span>
              <span className="history-item-date">{m.date}</span>
              {m.tags && (() => {
                try {
                  const tags: string[] = JSON.parse(m.tags);
                  return tags.length ? (
                    <div className="history-item-tags">
                      {tags.slice(0, 2).map((t) => <span key={t} className="history-tag">{t}</span>)}
                    </div>
                  ) : null;
                } catch { return null; }
              })()}
            </button>
          ))}
          {meetingsHistory.length === 0 && <p className="empty-label">No past meetings</p>}
        </aside>

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
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
