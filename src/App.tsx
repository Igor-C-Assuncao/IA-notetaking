import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import "./App.css";

/**
 * Interface representing a meeting record from the database
 */
interface Meeting {
  id: number;
  date: string;
  title: string;
  raw_transcript: string;
  markdown_summary: string;
}

function App() {
  // --- APPLICATION STATE ---
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Initializing system...");
  const [transcription, setTranscription] = useState("");
  const [notes, setNotes] = useState("");
  
  // --- HISTORY STATE ---
  const [meetingsHistory, setMeetingsHistory] = useState<Meeting[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<number | null>(null);

  // --- SETTINGS STATE (BYOK) ---
  const [showSettings, setShowSettings] = useState(false);
  const [provider, setProvider] = useState("ollama");
  const [modelName, setModelName] = useState("llama3");
  const [apiKey, setApiKey] = useState("");

  /**
   * Load user preferences from the secure store on mount
   */
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const store = await load("settings.json", {
          autoSave: false,
          defaults: {}
        });
        const savedProvider = await store.get<string>("provider");
        const savedModel = await store.get<string>("modelName");
        const savedApiKey = await store.get<string>("apiKey");

        if (savedProvider) setProvider(savedProvider);
        if (savedModel) setModelName(savedModel);
        if (savedApiKey) setApiKey(savedApiKey);
      } catch (e) {
        console.error("Failed to load settings:", e);
      }
    };
    loadSettings();
    loadHistory();
  }, []);

  /**
   * Persists current settings to the secure storage
   */
  const saveSettings = async () => {
    try {
      const store = await load("settings.json", {
        autoSave: false,
        defaults: {}
      });
      await store.set("provider", provider);
      await store.set("modelName", modelName);
      await store.set("apiKey", apiKey);
      await store.save();
      
      setShowSettings(false);
      setStatus("Settings saved successfully");
    } catch (e) {
      console.error("Failed to save settings:", e);
      setStatus("Error saving configuration");
    }
  };

  /**
   * Fetches the meeting list from the SQLite database
   */
  const loadHistory = async () => {
    try {
      const meetings: Meeting[] = await invoke("get_meetings");
      setMeetingsHistory(meetings);
    } catch (error) {
      console.error("Database fetch error:", error);
    }
  };

  /**
   * Event listener for Python backend messages
   */
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
            }
            break;
          case "PIPELINE_STATUS":
            setStatus(parsed.data.step);
            break;
          case "TRANSCRIPTION_COMPLETED":
            setTranscription(parsed.data.text);
            break;
          case "NOTES_GENERATED":
            const generatedNotes = parsed.data.markdown;
            setNotes(generatedNotes);
            
            // Save to database automatically
            try {
              await invoke("save_meeting", {
                date: new Date().toLocaleString(),
                title: `Meeting ${new Date().toLocaleDateString()}`,
                rawTranscript: transcription,
                markdownSummary: generatedNotes
              });
              await loadHistory();
            } catch (dbError) {
              console.error("Database save error:", dbError);
            }
            break;
          case "ERROR":
            setStatus(`Error: ${parsed.data.message}`);
            break;
        }
      } catch (e) {
        console.error("Payload parsing error", e);
      }
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, [transcription]);

  /**
   * Handles recording start/stop and sends settings to Python
   */
  const toggleRecording = async () => {
    const action = isRecording ? "STOP_RECORDING" : "START_RECORDING";
    
    setIsRecording(!isRecording);
    setStatus(isRecording ? "Stopping..." : `Recording via ${provider.toUpperCase()}`);

    try {
      await invoke("send_command_to_python", {
        payload: JSON.stringify({ 
          action: action,
          llm_provider: provider,
          llm_model: modelName,
          api_key: apiKey
        })
      });
    } catch (error) {
      console.error("IPC bridge error:", error);
      setStatus("Engine connection failed");
    }
  };

  /**
   * Clipboard and Export Actions
   */
  const handleCopyToClipboard = async () => {
    await writeText(notes);
    setStatus("Copied to clipboard!");
    setTimeout(() => setStatus("Ready"), 2000);
  };

  const handleExportAsMarkdown = async () => {
    const filePath = await save({
      filters: [{ name: 'Markdown', extensions: ['md'] }],
      defaultPath: `Notes_${new Date().getTime()}.md`
    });
    if (filePath) {
      await writeTextFile(filePath, notes);
      setStatus("File exported successfully");
    }
  };

  return (
    <div className="app-layout">
      {/* SIDEBAR: MEETING HISTORY */}
      <aside className="sidebar">
        <h2>📚 History</h2>
        <div className="history-list">
          {meetingsHistory.length === 0 ? (
            <p className="empty-label">No sessions found</p>
          ) : (
            meetingsHistory.map((meeting) => (
              <button 
                key={meeting.id}
                className={`history-item ${selectedMeetingId === meeting.id ? "active" : ""}`}
                onClick={() => {
                  setSelectedMeetingId(meeting.id);
                  setTranscription(meeting.raw_transcript);
                  setNotes(meeting.markdown_summary);
                }}
              >
                <span className="item-title">{meeting.title}</span>
                <span className="item-date">{meeting.date}</span>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* MAIN VIEW */}
      <main className="main-content">
        <button className="settings-trigger" onClick={() => setShowSettings(true)}>⚙️</button>

        <h1>🎙️ AI Notetaker</h1>
        
        <div className="status-panel">
          <p>Status: <span>{status}</span></p>
        </div>

        <div className="control-section">
          <button 
            className={`record-btn ${isRecording ? "recording" : ""}`}
            onClick={toggleRecording}
            disabled={selectedMeetingId !== null && !isRecording}
          >
            {isRecording ? "Stop Recording" : (selectedMeetingId ? "New Session" : "Start Recording")}
          </button>
        </div>
        
        {/* ACTION BAR */}
        {notes && (
          <div className="actions-bar">
            <button onClick={handleCopyToClipboard}>📋 Copy to Clipboard</button>
            <button onClick={handleExportAsMarkdown}>💾 Export as .MD</button>
          </div>
        )}

        {/* TRANSCRIPTION VIEW */}
        {transcription && (
          <section className="transcription-container">
            <h3>📝 Raw Transcript</h3>
            <p className="text-content">{transcription}</p>
          </section>
        )}

        {/* SUMMARY VIEW */}
        {notes && (
          <section className="summary-container">
            <h3>✨ Smart Summary</h3>
            <div className="markdown-content">
              <pre>{notes}</pre>
            </div>
          </section>
        )}

        {/* SETTINGS MODAL */}
        {showSettings && (
          <div className="modal-overlay">
            <div className="settings-modal">
              <h3>IA Configuration</h3>
              
              <div className="form-group">
                <label>LLM Provider</label>
                <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                  <option value="ollama">Ollama (Local)</option>
                  <option value="openai">OpenAI (Cloud)</option>
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
                  <input 
                    type="password" 
                    value={apiKey} 
                    placeholder="Enter your key..."
                    onChange={(e) => setApiKey(e.target.value)} 
                  />
                </div>
              )}

              <div className="modal-actions">
                <button className="btn-cancel" onClick={() => setShowSettings(false)}>Cancel</button>
                <button className="btn-save" onClick={saveSettings}>Save Changes</button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;