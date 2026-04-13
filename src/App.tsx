// src/App.tsx
import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core"; // <-- NOVO
import "./App.css";

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Waiting for IPC connection...");
  const [transcription, setTranscription] = useState(""); // <-- NOVO ESTADO

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
            if (parsed.data.is_recording) setTranscription(""); // Limpa a tela ao gravar de novo
            break;
          case "PIPELINE_STATUS":
            setStatus(parsed.data.step); // Mostra "Processing..." ou "Transcribing..."
            break;
          case "TRANSCRIPTION_COMPLETED": // <-- NOVO EVENTO RECEBIDO
            setStatus("Ready.");
            setTranscription(parsed.data.text);
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

  // NOVO: Função que lida com o clique do botão
  const toggleRecording = async () => {
    const action = isRecording ? "STOP_RECORDING" : "START_RECORDING";
    
    // Altera a UI imediatamente
    setIsRecording(!isRecording);
    setStatus(isRecording ? "Stopping capture..." : "Recording loopback...");

    try {
      // Chama a função Rust que criamos passando o JSON
      await invoke("send_command_to_python", {
        payload: JSON.stringify({ action: action })
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

      {/* CAIXA DE TRANSCRIÇÃO */}
      {transcription && (
        <div className="transcription-box" style={{ marginTop: '20px', padding: '15px', backgroundColor: '#1a1a1a', borderRadius: '8px', maxWidth: '350px' }}>
          <h3>📝 Transcrição</h3>
          <p style={{ textAlign: 'left', fontSize: '0.9em', lineHeight: '1.4' }}>{transcription}</p>
        </div>
      )}
    </main>
  );
}

export default App;