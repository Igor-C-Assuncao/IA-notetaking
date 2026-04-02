// src/App.tsx
import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

function App() {
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Waiting for IPC connection...");

  useEffect(() => {
    // Observer Pattern: Listen for the "python-event" emitted by Rust
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
          case "ERROR":
            setStatus(`Error: ${parsed.data.message}`);
            break;
        }
      } catch (e) {
        console.error("Failed to parse Python event", e);
      }
    });

    // Cleanup listener on unmount
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return (
    <main className="container">
      <h1>🎙️ AI Notetaker</h1>
      
      <div className="status-panel">
        <p>Engine Status: <span>{status}</span></p>
      </div>

      <button 
        className={isRecording ? "recording" : ""}
        onClick={() => setIsRecording(!isRecording)}
      >
        {isRecording ? "Stop Recording" : "Start Recording"}
      </button>
    </main>
  );
}

export default App;