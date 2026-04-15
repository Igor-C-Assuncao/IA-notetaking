import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import "./App.css";

interface Meeting {
  id: number;
  date: string;
  title: string;
  raw_transcript: string;
  markdown_summary: string;
}

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Aguardando motor Python...");
  const [transcription, setTranscription] = useState("");
  const [notes, setNotes] = useState("");
  
  const [meetingsHistory, setMeetingsHistory] = useState<Meeting[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<number | null>(null);

  // --- ESTADOS DAS CONFIGURAÇÕES (BYOK) ---
  const [showSettings, setShowSettings] = useState(false);
  const [provider, setProvider] = useState("ollama");
  const [modelName, setModelName] = useState("llama3");
  const [apiKey, setApiKey] = useState("");

  // Inicializa e lê o Cofre Seguro do Tauri
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
        console.error("Erro ao carregar configurações:", e);
      }
    };
    loadSettings();
  }, []);

  const saveSettings = async () => {
    try {
      const store = await load("settings.json");
      await store.set("provider", provider);
      await store.set("modelName", modelName);
      await store.set("apiKey", apiKey);
      await store.save(); // Salva no disco
      
      setShowSettings(false);
      setStatus("Configurações salvas no cofre!");
    } catch (e) {
      console.error("Erro ao salvar configurações:", e);
      setStatus("Erro ao salvar configurações.");
    }
  };

  const loadHistory = async () => {
    try {
      const meetings: Meeting[] = await invoke("get_meetings");
      setMeetingsHistory(meetings);
    } catch (error) {
      console.error("Erro ao carregar histórico:", error);
    }
  };

  useEffect(() => {
    loadHistory();

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
            try {
              await invoke("save_meeting", {
                date: new Date().toLocaleString('pt-BR'),
                title: `Reunião ${new Date().toLocaleDateString('pt-BR')}`,
                rawTranscript: transcription,
                markdownSummary: generatedNotes
              });
              await loadHistory();
            } catch (dbError) {
              console.error("Erro ao salvar no banco:", dbError);
            }
            break;
          case "ERROR":
            setStatus(`Erro: ${parsed.data.message}`);
            break;
        }
      } catch (e) {
        console.error("Falha ao processar evento Python", e);
      }
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, [transcription]);

  const toggleRecording = async () => {
    const action = isRecording ? "STOP_RECORDING" : "START_RECORDING";
    
    setIsRecording(!isRecording);
    setStatus(isRecording ? "Parando captura..." : `Gravando e usando ${provider.toUpperCase()}...`);

    try {
      // INJETANDO AS CONFIGURAÇÕES DINÂMICAS NO PYTHON
      await invoke("send_command_to_python", {
        payload: JSON.stringify({ 
          action: action,
          llm_provider: provider,
          llm_model: modelName,
          api_key: apiKey
        })
      });
    } catch (error) {
      console.error("Erro na ponte IPC:", error);
      setStatus("Falha de comunicação com motor.");
    }
  };

  // Sugestões de modelo ao trocar de provedor
  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProv = e.target.value;
    setProvider(newProv);
    if (newProv === "ollama") setModelName("llama3");
    if (newProv === "openai") setModelName("gpt-4o");
    if (newProv === "gemini") setModelName("gemini-2.5-flash");
    if (newProv === "anthropic") setModelName("claude-3-haiku-20240307");
  };

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', margin: 0, padding: 0 }}>
      
      <aside style={{ width: '280px', backgroundColor: '#1e1e1e', borderRight: '1px solid #333', padding: '20px', overflowY: 'auto' }}>
        <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>📚 Meu Histórico</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {meetingsHistory.length === 0 ? (
            <p style={{ fontSize: '0.9em', color: '#888' }}>Nenhuma reunião salva.</p>
          ) : (
            meetingsHistory.map((meeting) => (
              <button 
                key={meeting.id}
                onClick={() => {
                  setSelectedMeetingId(meeting.id);
                  setTranscription(meeting.raw_transcript);
                  setNotes(meeting.markdown_summary);
                }}
                style={{
                  textAlign: 'left', padding: '10px',
                  backgroundColor: selectedMeetingId === meeting.id ? '#4CAF50' : '#2a2a2a',
                  color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer'
                }}
              >
                <div style={{ fontWeight: 'bold' }}>{meeting.title}</div>
                <div style={{ fontSize: '0.8em', opacity: 0.8 }}>{meeting.date}</div>
              </button>
            ))
          )}
        </div>
      </aside>

      <main className="container" style={{ flex: 1, padding: '40px', overflowY: 'auto', position: 'relative' }}>
        
        {/* BOTÃO DE CONFIGURAÇÕES */}
        <button 
          onClick={() => setShowSettings(true)}
          style={{ position: 'absolute', top: '20px', right: '40px', background: 'transparent', fontSize: '1.5rem', cursor: 'pointer', border: 'none' }}
        >
          ⚙️
        </button>

        <h1>🎙️ AI Notetaker</h1>
        
        <div className="status-panel">
          <p>Engine Status: <span>{status}</span></p>
        </div>

        <button 
          className={isRecording ? "recording" : ""}
          onClick={toggleRecording}
          disabled={selectedMeetingId !== null && !isRecording}
        >
          {isRecording ? "Parar Gravação" : (selectedMeetingId ? "Iniciar Nova Gravação" : "Iniciar Gravação")}
        </button>
        
        {transcription && (
          <div className="transcription-box" style={{ marginTop: '20px', padding: '15px', backgroundColor: '#1a1a1a', borderRadius: '8px' }}>
            <h3>📝 Transcrição Bruta</h3>
            <p style={{ textAlign: 'left', fontSize: '0.9em', lineHeight: '1.4' }}>{transcription}</p>
          </div>
        )}

        {notes && (
          <div className="notes-box" style={{ marginTop: '20px', padding: '15px', backgroundColor: '#2a2a2a', borderRadius: '8px', borderLeft: '4px solid #4CAF50' }}>
            <h3 style={{ color: '#4CAF50' }}>✨ Resumo Inteligente (Markdown)</h3>
            <pre style={{ textAlign: 'left', fontSize: '0.9em', whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
              {notes}
            </pre>
          </div>
        )}

        {/* MODAL DE CONFIGURAÇÕES */}
        {showSettings && (
          <div style={{
            position: 'absolute', top: '50px', right: '40px', width: '320px',
            backgroundColor: '#242424', padding: '20px', borderRadius: '12px',
            boxShadow: '0px 10px 30px rgba(0,0,0,0.5)', border: '1px solid #444', zIndex: 100
          }}>
            <h3 style={{ marginTop: 0 }}>Configurações de IA</h3>
            
            <div style={{ marginBottom: '15px', textAlign: 'left' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em' }}>Provedor LLM</label>
              <select 
                value={provider} 
                onChange={handleProviderChange}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', backgroundColor: '#1a1a1a', color: 'white', border: '1px solid #555' }}
              >
                <option value="ollama">Local (Ollama)</option>
                <option value="openai">OpenAI (ChatGPT)</option>
                <option value="gemini">Google Gemini</option>
                <option value="anthropic">Anthropic Claude</option>
              </select>
            </div>

            <div style={{ marginBottom: '15px', textAlign: 'left' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em' }}>Modelo Específico</label>
              <input 
                type="text" 
                value={modelName} 
                onChange={(e) => setModelName(e.target.value)}
                style={{ width: '100%', padding: '8px', borderRadius: '4px', backgroundColor: '#1a1a1a', color: 'white', border: '1px solid #555' }}
              />
            </div>

            {provider !== "ollama" && (
              <div style={{ marginBottom: '20px', textAlign: 'left' }}>
                <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9em' }}>API Key ({provider})</label>
                <input 
                  type="password" 
                  value={apiKey} 
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', backgroundColor: '#1a1a1a', color: 'white', border: '1px solid #555' }}
                />
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowSettings(false)} style={{ padding: '8px 12px', fontSize: '0.9em', backgroundColor: '#444' }}>Cancelar</button>
              <button onClick={saveSettings} style={{ padding: '8px 12px', fontSize: '0.9em', backgroundColor: '#4CAF50', color: 'white' }}>Salvar</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;