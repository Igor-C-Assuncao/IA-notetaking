// src/App.tsx
import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Waiting for IPC connection...");
  const [transcription, setTranscription] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    const unlisten = listen<string>("python-event", (event) => {
      try {
        const parsed = JSON.parse(event.payload);
        switch (parsed.event) {
          case "SYSTEM_READY":
            setStatus(parsed.data.status);
            break;
          case "RECORDING_STATUS":
            setIsRecording(parsed.data.is_recording);
            // Limpa a tela ao iniciar uma nova gravação
            if (parsed.data.is_recording) {
              setTranscription(""); 
              setNotes(""); 
            }
            break;
          case "PIPELINE_STATUS":
            setStatus(parsed.data.step);
            break;
          case "TRANSCRIPTION_COMPLETED":
            setTranscription(parsed.data.text);
            break;
          case "NOTES_GENERATED":
            setNotes(parsed.data.markdown);
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
  }, []);

  const toggleRecording = async () => {
    const action = isRecording ? "STOP_RECORDING" : "START_RECORDING";
    
    setIsRecording(!isRecording);
    setStatus(isRecording ? "Stopping capture..." : "Recording loopback...");

    try {
      // Injetando o comando com Ollama como provedor padrão para testes locais
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

  return (
    <main className="container">
      <h1>🎙️ AI Notetaker</h1>
      
      <div className="status-panel">
        <p>Engine Status: <span>{status}</span></p>
      </div>

      <button 
        className={isRecording ? "recording" : ""}
        onClick={toggleRecording}
      >
        {isRecording ? "Stop Recording" : "Start Recording"}
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
  );
}

export default App;