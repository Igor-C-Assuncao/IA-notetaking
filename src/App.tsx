// src/App.tsx (Trechos atualizados)
import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Waiting for IPC connection...");
  const [transcription, setTranscription] = useState("");
  const [notes, setNotes] = useState(""); // <-- NOVO ESTADO PARA AS NOTAS

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
            if (parsed.data.is_recording) {
              setTranscription(""); 
              setNotes(""); // Limpa as notas ao iniciar nova gravação
            }
            break;
          case "PIPELINE_STATUS":
            setStatus(parsed.data.step);
            break;
          case "TRANSCRIPTION_COMPLETED":
            setTranscription(parsed.data.text);
            break;
          case "NOTES_GENERATED": // <-- NOVO EVENTO RECEBIDO
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
      // Por enquanto estamos mandando os valores default no payload
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

  // ... (O resto do render continua, adicione a div de notas no final)
  return (
    <main className="container">
      {/* ... Cabeçalho e Botões ... */}
      
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