<div align="center">
  <img src="public/logo-mark-white.png" alt="AI NoteTaking" width="160" />

  <h1>AI NoteTaking</h1>

  <p>An open-source, invisible, privacy-first AI notetaker for your meetings.</p>

  [![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
  [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
  [![Tauri](https://img.shields.io/badge/Tauri_2-App-FFC131?logo=tauri&logoColor=white)](https://tauri.app/)
  [![Python](https://img.shields.io/badge/Python_3.10+-Backend-3776AB?logo=python&logoColor=white)](https://www.python.org/)
  [![React](https://img.shields.io/badge/React-Frontend-61DAFB?logo=react&logoColor=black)](https://react.dev/)
</div>

---

Captures audio from your microphone and system (loopback) during meetings, then generates accurate transcripts and structured summaries — without inviting invasive bots into your Zoom, Meet, or Teams calls.

Built with a high-performance hybrid architecture: **Tauri 2 + Rust + Python**.

## Features

- **Invisible capture** — records system audio and microphone natively via loopback; no bots, no meeting links, no permissions requested from the host.
- **Privacy-first, local-first** — full support for running LLMs 100% locally via [Ollama](https://ollama.com/), so sensitive data never leaves your machine.
- **Bring your own key (BYOK)** — prefer the cloud? Drop in your API key for OpenAI, Google Gemini, or Anthropic Claude and switch at any time.
- **Intelligent audio pipeline** — [Silero VAD](https://github.com/snakers4/silero-vad) filters silence before transcription, [WhisperX](https://github.com/m-bain/whisperX) handles speech-to-text, and a LangGraph agent extracts action items and generates the structured summary.
- **Compact floating widget** — sits as a small always-on-top pill while you work; expands to the full view when you need to review notes or browse meeting history.
- **Persistent history** — every session is saved locally in SQLite and available for review at any time.
- **Two themes** — Liquid Glass (dark) and Minimalist Notebook (light).

## Architecture

```
┌─────────────────────────────────────────────┐
│  Frontend  (React + TypeScript + Vite)       │
│  Compact widget  ·  Expanded view  ·  Themes │
└────────────────────┬────────────────────────┘
                     │  Tauri IPC (invoke / events)
┌────────────────────▼────────────────────────┐
│  Core  (Tauri 2 / Rust)                      │
│  Window management  ·  SQLite  ·  IPC bridge │
└────────────────────┬────────────────────────┘
                     │  stdin / stdout
┌────────────────────▼────────────────────────┐
│  AI Engine  (Python sidecar)                 │
│  Loopback capture  ·  VAD  ·  WhisperX       │
│  LangGraph agent  ·  LLM providers           │
└─────────────────────────────────────────────┘
```

### Design patterns

| Pattern | Where it's used |
|---|---|
| **Strategy** | BYOK system — `OllamaStrategy`, `OpenAIStrategy`, `GeminiStrategy`, `AnthropicStrategy` share a common `LLMProvider` interface and are swapped at runtime from user settings. |
| **Factory Method** | Audio capture — `AudioCaptureFactory` evaluates the OS and instantiates either `WASAPICapture` (Windows) or `ScreenCaptureKitAdapter` (macOS). |
| **Observer / Pub-Sub** | UI reactivity — the Python engine emits events (`VAD_SPEECH_DETECTED`, `TRANSCRIPTION_COMPLETED`, etc.) over IPC; the Tauri frontend listens and updates state in real time. |
| **Pipeline / Chain of Responsibility** | Audio-to-notes flow — `Audio Mixer → Silero VAD → WhisperX → LangGraph Agent`. Each stage has a single responsibility and can be replaced independently. |

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Python](https://www.python.org/) 3.10+

### Install and run

```bash
# 1. Clone
git clone https://github.com/your-username/ai-notetaking.git
cd ai-notetaking

# 2. Frontend and Rust dependencies
npm install

# 3. Python backend
cd src-python
pip install -r requirements.txt
cd ..

# 4. Start dev environment
npm run tauri dev
```

### Build for production

```bash
npm run tauri build
```

## Configuration

Open the settings panel (gear icon on the widget) to configure:

| Setting | Description |
|---|---|
| **Provider** | `Ollama` (local) · `OpenAI` · `Gemini` · `Anthropic` |
| **Model** | Any model name supported by the selected provider |
| **API Key** | Required for cloud providers; not stored for Ollama |
| **Theme** | Liquid Glass (dark) or Minimalist Notebook (light) |

Settings are persisted locally via `tauri-plugin-store`.

## Roadmap

| Sprint | Status | Scope |
|---|---|---|
| 0 — Foundation | ✅ Done | Project scaffold, Tauri + Python IPC bridge, SQLite |
| 1 — Audio capture | ✅ Done | Loopback capture, WASAPI / ScreenCaptureKit factory |
| 2 — VAD + Transcription | ✅ Done | Silero VAD, WhisperX integration |
| 3 — AI pipeline | ✅ Done | LangGraph agent, action item extraction, summaries |
| 4 — BYOK + Settings | ✅ Done | Multi-provider support, persistent settings, themes |
| 5 — UI polish | ✅ Done | Compact widget, expanded view, meeting history |
| 6 — Window UX | ✅ Done | Native drag region, window controls, popover window |
| 7 — Testing | 🔜 Planned | Unit and integration tests |
| 8 — v1.0 Release | 🔜 Planned | CI/CD, packaging, signed builds |

## Contributing

Contributions are welcome. If you are interested in AI, desktop development, or audio engineering, check out the open issues and submit a pull request. Please follow the existing code conventions and include a clear description of what your change does.

## License

Licensed under the [Apache License 2.0](LICENSE).
