import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import "./App.css";

<<<<<<< HEAD
// Interface TypeScript para espelhar o Rust
=======
/**
 * Interface representing a meeting record from the database
 */
>>>>>>> 9fddd5801422561f41a8e35f039c77bf2cbb9532
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
  
<<<<<<< HEAD
  // Novos estados para o Histórico
  const [meetingsHistory, setMeetingsHistory] = useState<Meeting[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<number | null>(null);

  // Carrega o histórico ao abrir o app
  const loadHistory = async () => {
    try {
      const meetings: Meeting[] = await invoke("get_meetings");
      setMeetingsHistory(meetings);
    } catch (error) {
      console.error("Erro ao carregar histórico:", error);
    }
  };
=======
  // --- HISTORY STATE ---
  const [meetingsHistory, setMeetingsHistory] = useState<Meeting[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<number | null>(null);
>>>>>>> 9fddd5801422561f41a8e35f039c77bf2cbb9532

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
<<<<<<< HEAD
              setSelectedMeetingId(null); // Deseleciona o histórico para uma nova gravação
=======
              setSelectedMeetingId(null);
>>>>>>> 9fddd5801422561f41a8e35f039c77bf2cbb9532
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
            
<<<<<<< HEAD
            // AUTOMATIZAÇÃO: Salva no banco de dados assim que as notas são geradas!
            try {
              await invoke("save_meeting", {
                date: new Date().toLocaleString('pt-BR'),
                title: `Reunião ${new Date().toLocaleDateString('pt-BR')}`,
                rawTranscript: transcription, // Envia a transcrição atual do estado
                markdownSummary: generatedNotes
              });
              await loadHistory(); // Atualiza a barra lateral
            } catch (dbError) {
              console.error("Erro ao salvar no banco:", dbError);
=======
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
>>>>>>> 9fddd5801422561f41a8e35f039c77bf2cbb9532
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
<<<<<<< HEAD
  }, [transcription]); // Adicionamos 'transcription' na dependência para ele enxergar o estado atualizado no momento de salvar
=======
  }, [transcription]);
>>>>>>> 9fddd5801422561f41a8e35f039c77bf2cbb9532

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

  const handleSelectMeeting = (meeting: Meeting) => {
    setSelectedMeetingId(meeting.id);
    setTranscription(meeting.raw_transcript);
    setNotes(meeting.markdown_summary);
  };

  return (
<<<<<<< HEAD
    <div style={{ display: 'flex', height: '100vh', width: '100vw', margin: 0, padding: 0 }}>
      
      {/* --- SIDEBAR DE HISTÓRICO --- */}
      <aside style={{ width: '280px', backgroundColor: '#1e1e1e', borderRight: '1px solid #333', padding: '20px', overflowY: 'auto' }}>
        <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>📚 Meu Histórico</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {meetingsHistory.length === 0 ? (
            <p style={{ fontSize: '0.9em', color: '#888' }}>Nenhuma reunião salva ainda.</p>
=======
    <div className="app-layout">
      {/* SIDEBAR: MEETING HISTORY */}
      <aside className="sidebar">
        <h2>📚 History</h2>
        <div className="history-list">
          {meetingsHistory.length === 0 ? (
            <p className="empty-label">No sessions found</p>
>>>>>>> 9fddd5801422561f41a8e35f039c77bf2cbb9532
          ) : (
            meetingsHistory.map((meeting) => (
              <button 
                key={meeting.id}
<<<<<<< HEAD
                onClick={() => handleSelectMeeting(meeting)}
                style={{
                  textAlign: 'left',
                  padding: '10px',
                  backgroundColor: selectedMeetingId === meeting.id ? '#4CAF50' : '#2a2a2a',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                <div style={{ fontWeight: 'bold' }}>{meeting.title}</div>
                <div style={{ fontSize: '0.8em', opacity: 0.8 }}>{meeting.date}</div>
=======
                className={`history-item ${selectedMeetingId === meeting.id ? "active" : ""}`}
                onClick={() => {
                  setSelectedMeetingId(meeting.id);
                  setTranscription(meeting.raw_transcript);
                  setNotes(meeting.markdown_summary);
                }}
              >
                <span className="item-title">{meeting.title}</span>
                <span className="item-date">{meeting.date}</span>
>>>>>>> 9fddd5801422561f41a8e35f039c77bf2cbb9532
              </button>
            ))
          )}
        </div>
      </aside>

<<<<<<< HEAD
      {/* --- ÁREA PRINCIPAL --- */}
      <main className="container" style={{ flex: 1, padding: '40px', overflowY: 'auto' }}>
        <h1>🎙️ AI Notetaker</h1>
        
        <div className="status-panel">
          <p>Engine Status: <span>{status}</span></p>
        </div>

        <button 
          className={isRecording ? "recording" : ""}
          onClick={toggleRecording}
          disabled={selectedMeetingId !== null && !isRecording} // Evita gravar por cima visualmente se estiver olhando o histórico
        >
          {isRecording ? "Stop Recording" : (selectedMeetingId ? "Start New Recording" : "Start Recording")}
        </button>
        
        {/* Exibição da Transcrição */}
        {transcription && (
          <div className="transcription-box" style={{ marginTop: '20px', padding: '15px', backgroundColor: '#1a1a1a', borderRadius: '8px' }}>
            <h3>📝 Transcrição Bruta</h3>
            <p style={{ textAlign: 'left', fontSize: '0.9em', lineHeight: '1.4' }}>{transcription}</p>
          </div>
        )}

        {/* Exibição das Notas Geradas */}
        {notes && (
          <div className="notes-box" style={{ marginTop: '20px', padding: '15px', backgroundColor: '#2a2a2a', borderRadius: '8px', borderLeft: '4px solid #4CAF50' }}>
            <h3 style={{ color: '#4CAF50' }}>✨ Resumo Inteligente (Markdown)</h3>
            <pre style={{ textAlign: 'left', fontSize: '0.9em', whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
              {notes}
            </pre>
=======
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
>>>>>>> 9fddd5801422561f41a8e35f039c77bf2cbb9532
          </div>
        )}
      </main>
    </div>
  );
}

export default App;