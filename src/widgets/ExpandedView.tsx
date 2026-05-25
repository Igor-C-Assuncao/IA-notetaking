import { useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { GearIcon, ArrowsInSimpleIcon, MagnifyingGlassIcon, CopyIcon, ExportIcon, ChatCircleIcon } from "@phosphor-icons/react";
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
import { usePythonEvent } from "@app/providers/IpcProvider";
import { ReprocessModal } from "@features/meetings/components/ReprocessModal";
import { CopilotSidebar } from "@features/rag/components/CopilotSidebar";
import { parseActionItems, parseTldr } from "@features/summary/lib/parsers";
import { SummaryDashboard } from "@features/summary/components/SummaryDashboard";

export function ExpandedView({
  isTransitioning, toggleWindowMode
}: {
  isTransitioning: boolean; toggleWindowMode: () => void;
}) {
  const { settings } = useSettings();
  const { isLG, waveColor } = useTheme();
  const { isRecording, recordingSeconds, status, toggleRecording } = useRecording();
  const { setTranscriptionText, search, setSearch, filteredTranscript } = useTranscription();
  const { notes, setNotesText, tldr, actionItems, structuredSummary } = useSummary();
  const { meetingsHistory, selectedMeetingId, setSelectedMeetingId, sidebarSearch, setSidebarSearch, loadHistory } = useMeetings();
  
  const [activeTab, setActiveTab] = useState<"transcript" | "summary" | "actions">("transcript");
  const [copiedNotes, setCopiedNotes] = useState(false);
  const [copiedWebAI, setCopiedWebAI] = useState(false);

  const currentMeeting = meetingsHistory.find(m => m.id === selectedMeetingId);

  // Derive displayed transcript (applying search filter if active)
  const displayedTranscript = selectedMeetingId !== null && currentMeeting
    ? (search.trim()
        ? currentMeeting.raw_transcript
            .split("\n")
            .filter((l) => l.toLowerCase().includes(search.toLowerCase()))
            .join("\n")
        : currentMeeting.raw_transcript)
    : filteredTranscript;

  // Derive displayed summary notes
  const displayedNotes = selectedMeetingId !== null && currentMeeting
    ? currentMeeting.markdown_summary
    : notes;

  // Derive active TL;DR and action items from the displayed summary notes
  const displayedTldr = selectedMeetingId !== null && currentMeeting
    ? (currentMeeting.markdown_summary ? parseTldr(currentMeeting.markdown_summary) : null)
    : tldr;

  const displayedActionItems = selectedMeetingId !== null && currentMeeting
    ? (currentMeeting.markdown_summary ? parseActionItems(currentMeeting.markdown_summary) : [])
    : actionItems;

  const displayedStructured = useMemo(() => {
    if (selectedMeetingId !== null && currentMeeting) {
      if (currentMeeting.structured_summary) {
        try {
          return JSON.parse(currentMeeting.structured_summary);
        } catch (e) {
          return null;
        }
      }
      return null;
    }
    return structuredSummary;
  }, [selectedMeetingId, currentMeeting, structuredSummary]);

  const [showReprocessModal, setShowReprocessModal] = useState(false);
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastLink, setToastLink] = useState("");
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);

  const isWin = detectOS() === "win";

  usePythonEvent("NOTION_EXPORT_COMPLETED", (data) => {
    if (data.success) {
      setToastMessage("✓ Exported to Notion!");
      setToastLink(`notion://www.notion.so/${data.page_id}`);
      setTimeout(() => {
        setToastMessage("");
        setToastLink("");
      }, 8000);
    } else {
      setToastMessage(`❌ Notion failed: ${data.error || "Unknown error"}`);
      setTimeout(() => setToastMessage(""), 5000);
    }
  });

  const triggerExport = async (format: "md" | "obsidian" | "notion" | "json") => {
    setShowExportDropdown(false);
    const currentMeeting = meetingsHistory.find(m => m.id === selectedMeetingId);
    
    if (format === "notion") {
      if (!settings.notionToken || !settings.notionDatabaseId) {
        setToastMessage("❌ Notion connection not configured in Settings.");
        setTimeout(() => setToastMessage(""), 4000);
        return;
      }
      
      setToastMessage("Exporting to Notion...");
      
      try {
        const titleStr = currentMeeting?.title || `Meeting on ${new Date().toLocaleDateString()}`;
        const dateStr = currentMeeting?.date || new Date().toISOString();
        let tagsArr: string[] = [];
        let speakersArr: string[] = [];
        
        if (currentMeeting) {
          try {
            if (currentMeeting.tags) tagsArr = JSON.parse(currentMeeting.tags);
          } catch(e) {}
          try {
            if (currentMeeting.speakers) speakersArr = JSON.parse(currentMeeting.speakers);
          } catch(e) {}
        }
        
        await invoke("send_command_to_python", {
          payload: JSON.stringify({
            action: "EXPORT_NOTION",
            notion_token: settings.notionToken,
            notion_database_id: settings.notionDatabaseId,
            title: titleStr,
            date: dateStr,
            tags: tagsArr,
            speakers: speakersArr,
            markdown: displayedNotes,
          })
        });
      } catch (err) {
        setToastMessage(`❌ Export failed: ${String(err)}`);
        setTimeout(() => setToastMessage(""), 4000);
      }
      return;
    }

    if (format === "md") {
      const path = await save({
        filters: [{ name: "Markdown", extensions: ["md"] }],
        defaultPath: currentMeeting ? `${currentMeeting.title.replace(/\s+/g, "_")}.md` : `Notes_${Date.now()}.md`
      });
      if (path) {
        await writeTextFile(path, displayedNotes);
        setToastMessage("✓ Exported successfully!");
        setTimeout(() => setToastMessage(""), 3000);
      }
      return;
    }

    if (format === "obsidian") {
      const titleStr = currentMeeting?.title || `Meeting on ${new Date().toLocaleDateString()}`;
      const dateStr = currentMeeting?.date || new Date().toISOString();
      const dateOnly = dateStr.split(" ")[0];
      
      let speakersArr: string[] = [];
      let tagsArr: string[] = [];
      
      if (currentMeeting) {
        try {
          if (currentMeeting.speakers) speakersArr = JSON.parse(currentMeeting.speakers);
        } catch(e) {}
        try {
          if (currentMeeting.tags) tagsArr = JSON.parse(currentMeeting.tags);
        } catch(e) {}
      }

      const yamlFrontmatter = [
        "---",
        `title: "${titleStr}"`,
        `date: ${dateOnly}`,
        `participants: [${speakersArr.map(s => `"[[${s}]]"`).join(", ")}]`,
        `tags: [${tagsArr.join(", ")}]`,
        "---",
        ""
      ].join("\n");
      
      let body = displayedNotes;
      
      speakersArr.forEach(name => {
        const escaped = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`\\b${escaped}\\b`, 'g');
        body = body.replace(regex, `[[${name}]]`);
      });

      if (currentMeeting?.structured_summary) {
        try {
          const structured = JSON.parse(currentMeeting.structured_summary);
          if (structured.actions && Array.isArray(structured.actions)) {
            const obsidianActions = structured.actions.map((act: any) => {
              let line = `- [ ] ${act.what}`;
              if (act.due) line += ` 📅 ${act.due}`;
              if (act.who) line += ` 👤 [[${act.who}]]`;
              return line;
            }).join("\n");
            
            const actionItemsHeaderIndex = body.indexOf("## 🎯 Action Items");
            if (actionItemsHeaderIndex !== -1) {
              const nextHeaderIndex = body.indexOf("## ", actionItemsHeaderIndex + 3);
              if (nextHeaderIndex !== -1) {
                body = body.substring(0, actionItemsHeaderIndex) + "## 🎯 Action Items\n" + obsidianActions + "\n\n" + body.substring(nextHeaderIndex);
              } else {
                body = body.substring(0, actionItemsHeaderIndex) + "## 🎯 Action Items\n" + obsidianActions + "\n";
              }
            }
          }
        } catch (e) {}
      }
      
      if (tagsArr.length > 0) {
        body += "\n\n" + tagsArr.map(t => `#${t}`).join(" ");
      }
      
      const obsidianNotes = yamlFrontmatter + body;
      
      const defaultVaultPath = settings.obsidianVaultPath 
        ? `${settings.obsidianVaultPath}/Meetings/${currentMeeting ? currentMeeting.title.replace(/\s+/g, "_") : `Notes_${Date.now()}`}.md`
        : currentMeeting ? `${currentMeeting.title.replace(/\s+/g, "_")}.md` : `Notes_${Date.now()}.md`;

      const path = await save({
        filters: [{ name: "Markdown", extensions: ["md"] }],
        defaultPath: defaultVaultPath
      });
      if (path) {
        await writeTextFile(path, obsidianNotes);
        setToastMessage("✓ Exported to Obsidian!");
        setTimeout(() => setToastMessage(""), 3000);
      }
      return;
    }

    if (format === "json") {
      let structured: any = {};
      let speakersArr: any[] = [];
      let tagsArr: string[] = [];
      
      if (currentMeeting) {
        try {
          if (currentMeeting.structured_summary) structured = JSON.parse(currentMeeting.structured_summary);
        } catch(e) {}
        try {
          if (currentMeeting.speakers) speakersArr = JSON.parse(currentMeeting.speakers);
        } catch(e) {}
        try {
          if (currentMeeting.tags) tagsArr = JSON.parse(currentMeeting.tags);
        } catch(e) {}
      }
      
      const jsonContent = JSON.stringify({
        meta: {
          id: currentMeeting?.id || Date.now(),
          date: currentMeeting?.date || new Date().toISOString(),
          title: currentMeeting?.title || "Live Session Summary",
          duration_seconds: 0,
          provider: settings.provider,
          model: settings.modelName,
        },
        transcript: {
          raw: displayedTranscript || "",
          diarized: [],
        },
        summary: {
          tldr: structured.tldr || "",
          decisions: structured.decisions || [],
          actions: structured.actions || [],
          tags: tagsArr,
          markdown: displayedNotes,
        },
        entities: {
          speakers: speakersArr,
          numbers: [],
          dates: [],
        }
      }, null, 2);

      const yyyymmdd = (currentMeeting?.date || new Date().toISOString().split(" ")[0]).split(" ")[0];
      const defaultFilename = `meeting_${currentMeeting?.id || "live"}_${yyyymmdd}.json`;

      const path = await save({
        filters: [{ name: "JSON", extensions: ["json"] }],
        defaultPath: defaultFilename
      });
      
      if (path) {
        await writeTextFile(path, jsonContent);
        setToastMessage("✓ JSON Exported!");
        setTimeout(() => setToastMessage(""), 3000);
      }
      return;
    }
  };

  const safeWriteText = async (text: string) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {
      console.warn("navigator.clipboard failed, trying tauri clipboard:", e);
    }
    try {
      await writeText(text);
      return true;
    } catch (e) {
      console.error("All clipboard methods failed:", e);
      return false;
    }
  };

  const handleCopy = async () => {
    const success = await safeWriteText(displayedNotes);
    if (success) {
      setCopiedNotes(true);
      setTimeout(() => setCopiedNotes(false), 2000);
    }
  };



  const handleExportForWebAI = async () => {
    const prompt = `Here is a transcript of a meeting. Please provide a brief TL;DR, identify key decisions, and list action items assigned to people.\n\n[Transcript]\n\n${displayedTranscript || "No transcript available."}`;
    const success = await safeWriteText(prompt);
    if (success) {
      setCopiedWebAI(true);
      setTimeout(() => setCopiedWebAI(false), 2000);
    }
  };

  const handleRecordClick = () => {
    if (selectedMeetingId !== null) {
      setSelectedMeetingId(null);
      if (setTranscriptionText) setTranscriptionText("");
      if (setNotesText) setNotesText("");
    }
    toggleRecording();
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
          <button className="icon-btn" onClick={() => invoke("open_popover_window")} title="Settings">
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
            <div 
              className={`history-item current ${isRecording ? "recording" : ""} ${selectedMeetingId === null ? "active" : ""}`}
              style={{ cursor: "pointer" }}
              onClick={() => {
                setSelectedMeetingId(null);
                if (setTranscriptionText) setTranscriptionText("");
                if (setNotesText) setNotesText("");
                setActiveTab("transcript");
              }}
            >
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
              {selectedMeetingId !== null && !isRecording && (
                <button
                  className="record-btn-expanded secondary"
                  style={{ marginRight: "8px", background: "rgba(255,255,255,0.05)", border: "1px solid var(--border)", color: "var(--text)" }}
                  onClick={() => setShowReprocessModal(true)}
                >
                  Reprocess
                </button>
              )}
              <button
                className={`record-btn-expanded ${isRecording ? "recording" : ""}`}
                onClick={handleRecordClick}
              >
                {isRecording ? <span className="stop-square-sm" /> : <span className="record-circle-sm" />}
                {isRecording ? "Stop" : selectedMeetingId ? "New Session" : "Record"}
              </button>
              {settings.ragEnabled && (
                <button
                  className={`record-btn-expanded secondary ${isCopilotOpen ? "active" : ""}`}
                  style={{ 
                    marginLeft: "8px", 
                    background: isCopilotOpen ? "var(--accent)" : "rgba(255,255,255,0.05)", 
                    border: "1px solid var(--border)", 
                    color: isCopilotOpen ? "#fff" : "var(--text)" 
                  }}
                  onClick={() => setIsCopilotOpen(!isCopilotOpen)}
                  title="Toggle AI Copilot sidebar chat"
                >
                  🤖 Copilot
                </button>
              )}
            </div>
          </div>

          <div className="tab-bar">
            <div className="tabs">
              {(["transcript", "summary", "actions"] as const).map((t) => (
                <button key={t} className={`tab-btn ${activeTab === t ? "active" : ""}`} onClick={() => setActiveTab(t)}>
                  {t === "transcript" && "Transcript"}
                  {t === "summary" && "Summary"}
                  {t === "actions" && `Action Items${displayedActionItems.length ? ` · ${displayedActionItems.length}` : ""}`}
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
                {displayedTranscript
                  ? <pre className="transcript-text">{displayedTranscript}</pre>
                  : <div className="empty-state">
                    {isRecording
                      ? <><Waveform width={60} height={14} color={waveColor} active bars={14} /><span>Transcribing…</span></>
                      : <span>Start recording to see the transcript here.</span>}
                  </div>}
              </div>
            )}
            {activeTab === "summary" && (
              <div className="tab-panel">
                {displayedStructured ? (
                  <SummaryDashboard summary={displayedStructured} />
                ) : displayedNotes ? (
                  <>
                    {displayedTldr && <div className="tldr-card"><div className="tldr-label">TL;DR</div><p className="tldr-body">{displayedTldr}</p></div>}
                    <pre className="summary-text">{displayedNotes}</pre>
                  </>
                ) : (
                  <div className="empty-state"><span>Summary will appear here once recording is processed.</span></div>
                )}
              </div>
            )}
            {activeTab === "actions" && (
              <div className="tab-panel">
                {displayedStructured && displayedStructured.action_items && displayedStructured.action_items.length > 0
                  ? <ul className="action-list">{displayedStructured.action_items.map((item: any, i: number) => (
                    <li key={i} className="action-item"><span className="action-checkbox" /><span className="action-text">{item.task} {item.assignee ? `(${item.assignee})` : ""}</span></li>
                  ))}</ul>
                  : displayedActionItems.length > 0
                  ? <ul className="action-list">{displayedActionItems.map((item, i) => (
                    <li key={i} className="action-item"><span className="action-checkbox" /><span className="action-text">{item}</span></li>
                  ))}</ul>
                  : <div className="empty-state"><span>{displayedNotes || displayedStructured ? "No action items found." : "Action items will appear here after processing."}</span></div>}
              </div>
            )}
          </div>

          {displayedNotes && (
            <div className="footer-actions">
              <button className="chip-btn" onClick={handleCopy}><CopyIcon size={13} /> {copiedNotes ? "✓ Copied!" : "Copy"}</button>
              
              <div style={{ position: "relative" }}>
                <button className="chip-btn" onClick={() => setShowExportDropdown(!showExportDropdown)}>
                  <ExportIcon size={13} /> Export ▾
                </button>
                {showExportDropdown && (
                  <div className="popover-window" style={{
                    position: "absolute",
                    bottom: "100%",
                    left: "0",
                    marginBottom: "8px",
                    width: "160px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "4px",
                    padding: "6px",
                    zIndex: 50,
                    boxShadow: "var(--shadow-panel)",
                    background: "var(--popover-bg, var(--bg-panel))",
                    border: "1px solid var(--border-strong)",
                    borderRadius: "var(--radius-sm)",
                    backdropFilter: "blur(10px)"
                  }}>
                    <button className="popover-tab-btn" style={{ textAlign: "left", padding: "6px 8px", fontSize: "12px", width: "100%" }} onClick={() => triggerExport("md")}>
                      Markdown (.md)
                    </button>
                    <button className="popover-tab-btn" style={{ textAlign: "left", padding: "6px 8px", fontSize: "12px", width: "100%" }} onClick={() => triggerExport("obsidian")}>
                      Obsidian (.md)
                    </button>
                    <button className="popover-tab-btn" style={{ textAlign: "left", padding: "6px 8px", fontSize: "12px", width: "100%" }} onClick={() => triggerExport("notion")}>
                      Notion Database
                    </button>
                    <button className="popover-tab-btn" style={{ textAlign: "left", padding: "6px 8px", fontSize: "12px", width: "100%" }} onClick={() => triggerExport("json")}>
                      JSON (.json)
                    </button>
                  </div>
                )}
              </div>
              
              <button className="chip-btn" onClick={handleExportForWebAI}><ChatCircleIcon size={13} /> {copiedWebAI ? "✓ Copied for Web AI!" : "Copy for Web AI"}</button>
            </div>
          )}
        </main>
        
        {isCopilotOpen && settings.ragEnabled && (
          <CopilotSidebar
            isOpen={isCopilotOpen}
            onClose={() => setIsCopilotOpen(false)}
            meetingsHistory={meetingsHistory}
            setSelectedMeetingId={setSelectedMeetingId}
          />
        )}
      </div>

      {showReprocessModal && selectedMeetingId !== null && (() => {
        const m = meetingsHistory.find(meet => meet.id === selectedMeetingId);
        return m ? (
          <ReprocessModal
            meetingId={selectedMeetingId}
            originalTitle={m.title}
            originalDate={m.date}
            originalSummary={m.markdown_summary}
            onClose={() => setShowReprocessModal(false)}
            onSuccess={(newMarkdown) => {
              setNotesText(newMarkdown);
              loadHistory();
              setToastMessage(`✓ Reprocessed summary successfully!`);
              setTimeout(() => setToastMessage(""), 3000);
            }}
          />
        ) : null;
      })()}

      {toastMessage && (
        <div style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          background: "var(--bg-panel)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-md)",
          padding: "10px 14px",
          boxShadow: "var(--shadow-panel)",
          backdropFilter: "blur(10px)",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          zIndex: 1000,
          animation: "toast-fade-in 200ms ease-out"
        }}>
          <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--text)" }}>{toastMessage}</span>
          {toastLink && (
            <a 
              href={toastLink} 
              target="_blank" 
              rel="noreferrer" 
              className="popover-btn primary" 
              style={{
                padding: "4px 8px",
                fontSize: "10.5px",
                minHeight: "unset",
                height: "22px",
                borderRadius: "var(--radius-sm)",
                display: "inline-flex",
                alignItems: "center",
                textDecoration: "none"
              }}
            >
              Open
            </a>
          )}
        </div>
      )}
    </div>
  );
}
