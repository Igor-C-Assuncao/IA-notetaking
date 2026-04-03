// src/App.tsx
import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core"; // <-- NOVO
import "./App.css";

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Waiting for IPC connection...");

  useEffect(() => {
    const unlisten = listen<string>("python-event", (event) => {
      try {
        const parsed = JSON.parse(event.payload);
        switch (parsed.event) {
          case "SYSTEM_READY":
            setStatus(parsed.data.status);
            break;
          case "VAD_SPEECH_DETECTED":
            setStatus(`Speech detected! Confidence: ${parsed.data.confidence}`);
            break;
          case "RECORDING_STATUS":
            setIsRecording(parsed.data.is_recording);
            break;
          case "PIPELINE_STATUS": // <-- NOVO: Mostra onde o arquivo salvou
            setStatus(`Audio salvo em: ${parsed.data.file}`);
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
        onClick={toggleRecording} // <-- Chama a nossa nova função
      >
        {isRecording ? "Stop Recording" : "Start Recording"}
      </button>
    </main>
  );
}

export default App;