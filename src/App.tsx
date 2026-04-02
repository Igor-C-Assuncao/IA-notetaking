// src/App.tsx
import { useState } from "react";
import "./App.css";

function App() {
  const [isRecording, setIsRecording] = useState(false);

  return (
    <main className="container">
      <h1>🎙️ AI Notetaker</h1>
      
      <div className="status-panel">
        <p>Status do Motor: <span>Aguardando conexão IPC...</span></p>
      </div>

      <button 
        className={isRecording ? "recording" : ""}
        onClick={() => setIsRecording(!isRecording)}
      >
        {isRecording ? "Parar Gravação" : "Iniciar Gravação"}
      </button>
    </main>
  );
}

export default App;