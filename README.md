🎙️ IA NoteTaking 


[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
[![Tauri](https://img.shields.io/badge/Tauri-App-FFC131?logo=tauri&logoColor=white)](https://tauri.app/)
[![Python](https://img.shields.io/badge/Python-Backend-3776AB?logo=python&logoColor=white)](https://www.python.org/)


**IA NoteTaking ** is an open-source, invisible, and privacy-first AI Notetaker. It captures audio from your microphone and system (loopback) during meetings to generate accurate transcripts and summaries, without the need to invite invasive "bots" to your calls (Zoom, Meet, Teams).

Built with a high-performance hybrid architecture (**Tauri + Rust + Python**) and utilizing rigorous software engineering patterns to make community contributions seamless.

## ✨ Key Features

* **Invisible Capture (Loopback):** Records system and microphone audio natively, keeping invasive bots out of your meeting rooms.
* **Privacy-First (Local-First):** Native support for running large language models 100% locally via **Ollama**, ensuring sensitive corporate data never leaves your machine.
* **Bring Your Own Key (BYOK):** Don't want to run models locally? Enter your API keys in the settings and use state-of-the-art models (OpenAI, Google Gemini, Anthropic).
* **Intelligent AI Pipeline:** Uses **Silero VAD** for voice activity detection (saving CPU/bandwidth) and orchestrates intelligent *Action Item* extraction using **LangGraph**.
* **Cross-Platform:** Planned support for Windows (WASAPI) and macOS (ScreenCaptureKit).

## 🏗️ Architecture

The project adopts a modular, sidecar-based architecture:

1. **Frontend (React/Vue/Svelte):** Lightweight and minimalist UI.
2. **Core (Tauri / Rust):** Manages the app lifecycle, OS native permissions, and local data persistence (SQLite).
3. **Audio & AI Engine (Python Sidecar):** An isolated Python process handling loopback capture, VAD, transcription (WhisperX), and LLM communication. It communicates with Tauri via IPC (Inter-Process Communication).

## 🧩 Design Patterns

To ensure the codebase remains scalable, testable, and easy for the community to contribute to, we actively adopt the following software engineering patterns:

* **Strategy Pattern:** Used at the core of our BYOK system. The application relies on a common `LLMProvider` interface. Depending on user settings, we instantiate different strategies at runtime, such as `OllamaStrategy` (local), `GeminiStrategy`, or `OpenAIStrategy` (cloud), without changing the core business logic.
  
* **Factory Method:** Applied when initializing audio capture. Since hardware access differs radically between operating systems, an `AudioCaptureFactory` evaluates the OS (Windows or macOS) and instantiates the correct class (`WASAPICapture` or `ScreenCaptureKitAdapter`), encapsulating OS complexity.

* **Observer / Pub-Sub Pattern:** Fundamental for UI reactivity. The Python audio engine (producer) emits state events via IPC, such as `VAD_SPEECH_DETECTED` or `TRANSCRIPTION_PROGRESS`. The Tauri frontend (observer) listens to these events and updates the graphical interface in real-time (e.g., changing the system tray icon from "Idle" to "Recording").

* **Pipeline / Chain of Responsibility:** Used in the audio-to-text processing flow. Raw data passes through a sequential, modular chain: `Audio Mixer` -> `Silero VAD (Silence Trimming)` -> `WhisperX (Transcription)` -> `LangGraph Agent (Extraction and Summary)`. Each node has a single responsibility and can be swapped out without breaking the pipeline.

## 🚀 Getting Started (Development Environment)

### Prerequisites
* [Node.js](https://nodejs.org/) (v18+)
* [Rust](https://www.rust-lang.org/tools/install)
* [Python](https://www.python.org/) (3.10+) and a package manager (`uv` or `poetry`)

### Installation

1. Clone the repository:
   ```bash
   git clone [https://github.com/your-username/your-project.git](https://github.com/your-username/your-project.git)
   cd your-project
   ```
   
2. Install Frontend and Rust dependencies:

```Bash
npm install
```
3. Set up the Python environment (Backend):

```Bash
cd src-python
pip install -r requirements.txt # or use poetry/uv
```

4. Start the development environment:

```Bash
npm run tauri dev
```

🗺️ Roadmap
Our development is divided into Sprints. Here’s what’s coming up:

Sprint 1: IPC bridge setup (Tauri <-> Python)

Sprint 2: Audio capture engine (Windows Loopback / macOS ScreenCaptureKit)

Sprint 3: VAD integration, WhisperX, and Agent orchestration (LangGraph)

Sprint 4: BYOK interface, local storage, and user settings

Sprint 5: CI/CD, testing, and v1.0 Release

🤝 Contributing
Contributions are extremely welcome! If you are passionate about AI, desktop development, or audio engineering, please see our CONTRIBUTING.md to understand how to set up your environment and submit your first Pull Request.

📄 License
This project is licensed under the Apache License 2.0 - see the LICENSE file for details.


Agora que a vitrine inteira está pronta em inglês e padronizada para o GitHub, podemos finalmente ir para o código! 

Gostaria de começar configurando a ponte de comunicação (IPC) entre o Rust e o Python (**Card 1.4**), ou prefere já criar a lógica do Padrão Factory em Python para a captura de áudio (**Card 2.1**)?

Com o repositório e a documentação base prontos, a verdadeira engenharia começa na comunicação entre a casca (Tauri/Rust) e o cérebro (Python). 

Você quer que eu construa agora o código do **Card 1.4** mostrando como enviar mensagens do Python