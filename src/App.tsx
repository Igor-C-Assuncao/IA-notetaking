// src/App.tsx
import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

// Interface TypeScript para espelhar o Rust
interface Meeting {
  id: number;
  date: string;
  title: string;
  raw_transcript: string;
  markdown_summary: string;
}

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Waiting for IPC connection...");
  const [transcription, setTranscription] = useState("");
  const [notes, setNotes] = useState("");
  
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
              setSelectedMeetingId(null); // Deseleciona o histórico para uma nova gravação
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
            }
            break;
          case "ERROR":
            setStatus(`Error: ${parsed.data.message}`);
            break;
        }
      } catch (e) {
        console.error("Failed to parse Python event", e);
      }
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, [transcription]); // Adicionamos 'transcription' na dependência para ele enxergar o estado atualizado no momento de salvar

  const toggleRecording = async () => {
    const action = isRecording ? "STOP_RECORDING" : "START_RECORDING";
    
    setIsRecording(!isRecording);
    setStatus(isRecording ? "Stopping capture..." : "Recording loopback...");

    try {
      await invoke("send_command_to_python", {
        payload: JSON.stringify({ 
          action: action,
          llm_provider: "ollama",
          llm_model: "llama3",
          api_key: ""
        })
      });
    } catch (error) {
      console.error("Erro na ponte IPC:", error);
      setStatus("Falha de comunicação com motor.");
    }
  };

  const handleSelectMeeting = (meeting: Meeting) => {
    setSelectedMeetingId(meeting.id);
    setTranscription(meeting.raw_transcript);
    setNotes(meeting.markdown_summary);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', margin: 0, padding: 0 }}>
      
      {/* --- SIDEBAR DE HISTÓRICO --- */}
      <aside style={{ width: '280px', backgroundColor: '#1e1e1e', borderRight: '1px solid #333', padding: '20px', overflowY: 'auto' }}>
        <h2 style={{ fontSize: '1.2rem', marginBottom: '20px' }}>📚 Meu Histórico</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {meetingsHistory.length === 0 ? (
            <p style={{ fontSize: '0.9em', color: '#888' }}>Nenhuma reunião salva ainda.</p>
          ) : (
            meetingsHistory.map((meeting) => (
              <button 
                key={meeting.id}
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
              </button>
            ))
          )}
        </div>
      </aside>

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
          </div>
        )}
      </main>
    </div>
  );
}

export default App;