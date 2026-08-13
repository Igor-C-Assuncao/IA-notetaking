<div align="center">
  <img src="public/logo-mark-white.png" alt="AI NoteTaking" width="160" />

  <h1>AI NoteTaking</h1>

  <p>An open-source, invisible, privacy-first AI notetaker for your meetings.</p>

  [![Version](https://img.shields.io/badge/Version-0.3.0-informational.svg)](https://github.com/Igor-C-Assuncao/IA-notetaking/releases)
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

- **Invisible meeting capture** - records microphone and system audio natively via loopback; no bots, meeting links, or host-side permissions.
- **Local-first AI engine** - runs fully local with Ollama, with optional BYOK cloud providers for OpenAI, Google Gemini, and Anthropic Claude.
- **Progressive startup** - audio capture becomes available while the transcription model loads in the background, with explicit engine state feedback.
- **Windows engine distribution** - ships downloadable CPU and split GPU engine assets with a manifest-driven runtime install flow.
- **Audio-to-intelligence pipeline** - Silero VAD, WhisperX, and LangGraph turn captured speech into transcripts, structured summaries, decisions, action items, and risks.
- **Evidence-backed summaries** - key claims include confidence, inference labels, transcript quotes, and timestamped source segment references.
- **Meeting briefing dashboard** - surfaces cross-meeting continuity, recurring topics, decision changes, follow-up drafts, chapters, and participation signals.
- **Live processing visibility** - reprocessing emits staged progress, elapsed time, token estimates, provider/model details, and token/billing status.
- **Per-source audio monitoring** - microphone and system audio levels are shown separately so capture problems are visible before transcription.
- **Compact desktop workflow** - always-on-top widget, expanded review view, local SQLite meeting history, settings, themes, and keychain-backed secrets.

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
| **Factory Method** | Audio capture — `AudioCaptureFactory` evaluates the OS and instantiates either `WindowsAudioCapture` (Windows), `MacosAudioCapture` (macOS), or `LinuxAudioCapture` (Linux). |
| **Observer / Pub-Sub** | UI reactivity — the Python engine emits events (`VAD_SPEECH_DETECTED`, `TRANSCRIPTION_COMPLETED`, etc.) over IPC; the Tauri frontend listens and updates state in real time. |
| **Pipeline / Chain of Responsibility** | Audio-to-notes flow — `Audio Mixer → Silero VAD → WhisperX → LangGraph Agent`. Each stage has a single responsibility and can be replaced independently. |

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Python](https://www.python.org/) 3.12

#### Linux (Ubuntu/Debian) system dependencies

Before running `npm run tauri dev`, install the native libraries required by Tauri:

```bash
sudo apt update && sudo apt install -y build-essential pkg-config libglib2.0-dev libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev patchelf
```

### Install and run

```bash
# 1. Clone
git clone https://github.com/Igor-C-Assuncao/IA-notetaking.git
cd IA-notetaking

# 2. Frontend and Rust dependencies
npm install

# 3. Python backend
cd src-python
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..

# 4. Start dev environment
npm run tauri dev
```

### Build for production

On Windows, build the CPU-only Python sidecar first. This avoids embedding the
multi-gigabyte CUDA Torch runtime in the default installer:

```bash
npm run sidecar:build:windows
npm run sidecar:check
npm run tauri build
```

The Windows sidecar release budget is 1536 MiB. The current validated CPU build
is approximately 405 MiB. See [docs/WINDOWS_SIDECAR_SIZE.md](docs/WINDOWS_SIDECAR_SIZE.md).

## Configuration

Open the settings panel (gear icon on the widget) to configure:

| Setting | Description |
|---|---|
| **Provider** | `Ollama` (local) · `OpenAI` · `Gemini` · `Anthropic` |
| **Model** | Any model name supported by the selected provider |
| **API Key** | Required for cloud providers; stored in the operating-system keychain |
| **Hugging Face Token** | Optional read token used to validate access to gated Pyannote diarization models |
| **Theme** | Liquid Glass (dark) or Minimalist Notebook (light) |

Non-secret settings are persisted locally via `tauri-plugin-store`.

## Quality and testing

```bash
# Frontend
npm test
npm run build

# Python
src-python\.venv\Scripts\python.exe -m pytest src-python\tests -q -m "not slow"

# Rust
cd src-tauri
cargo test
```

The benchmark harness scores transcription, evidence validity, decisions,
action items, assignees, hallucination rate, completion rate, and human review:

```bash
src-python\.venv\Scripts\python.exe benchmarks\run_benchmark.py \
  --input benchmarks\datasets\example_fixture.json
```

To exercise the report pipeline with generated prediction artifacts:

```bash
src-python\.venv\Scripts\python.exe benchmarks\run_benchmark.py \
  --input benchmarks\datasets\example_fixture.json \
  --generate-predictions \
  --prediction-mode mock
```

For local full-pipeline baselines, use `--prediction-mode llm` with a configured
provider/model and fixtures under `benchmarks/private/`. Transcript fixtures
benchmark the meeting-intelligence stage; audio fixtures run transcription first.

Generated reports are written to `benchmarks/reports/<timestamp>_<git-sha>/`.
See [benchmarks/README.md](benchmarks/README.md) for the fixture contract and
[docs/IMPLEMENTATION_PLAN_QUALITY_AND_CONFIGURATION.md](docs/IMPLEMENTATION_PLAN_QUALITY_AND_CONFIGURATION.md)
for the quality roadmap.

### Early real baseline

| Dataset | Mode | Run | Commit | Result |
|---|---|---|---|---|
| AMI `IB4001` | ASR, Ollama `llama3`, `--gate-profile asr` | `2026-06-16_211950_14bc2e7` | `14bc2e7` | PASS, weighted score `0.924`, WER `0.258`, CER `0.200`, latency `68.428s` |

The AMI row is a single-fixture transcription baseline and should be treated as
an early signal only. Representative AMI, QMSum, CORAA, consented internal
meeting fixtures, and larger LLM-generated QMSum runs are still required.

## Release history

### 0.3.0 (current)

- Progressive engine startup: recording readiness is no longer held behind Whisper model initialization
- Clear engine-state feedback while audio capture and transcription services come online
- Version consistency checks for the desktop app, Python sidecar, and release tag
- Release preparation focused on reliable Windows and macOS first-run behavior

### 0.2.2

- Preview DMG for Apple Silicon Macs with CPU and Metal/MPS acceleration
- Bundles the Python AI engine and native Core Audio Tap helper correctly
- Windows installer offers verified CPU or NVIDIA/CUDA engine downloads during first-run setup
- Ad-hoc signed distribution for early macOS testing; Gatekeeper may require manual approval

### 0.2.0

- Meeting briefing intelligence pipeline and briefing dashboard UI
- Cross-meeting continuity reports, follow-up drafts, chapters, participation signals, risks, open questions, and richer structured summaries
- Real-time reprocess progress (`REPROCESS_STATUS`: staged progress, elapsed time, token estimates, provider/model info)
- Per-source audio telemetry (mic vs system levels) with the new `AudioInputMeter` component
- Recording reliability fixes: captured audio is no longer dropped, near-silent recordings are rejected before transcription
- Windows runtime engine distribution: CPU asset, split GPU assets, and `engines-manifest.json` for runtime download/install
- Project licensing formalized: Apache 2.0 `LICENSE` + `NOTICE`, SPDX headers on all sources, DCO adopted for contributions, `CITATION.cff`

### 0.1.0

- Initial local desktop app: compact widget, expanded review view, meeting history in SQLite, Liquid Glass and Notebook themes
- Native loopback + microphone capture, Silero VAD, WhisperX transcription, and LangGraph summaries
- BYOK multi-provider support (Ollama, OpenAI, Gemini, Anthropic) with keychain-stored secrets
- Early benchmark harness and release gates for transcription/summary quality checks

## Roadmap to 1.0

| Version | Status | Focus |
|---|---|---|
| 0.1.0 | Released | Local desktop foundation: native capture, transcription, LangGraph summaries, BYOK providers, widget UI, local history |
| 0.2.0 | Released | Meeting intelligence: briefing dashboard, continuity, follow-up drafts, runtime progress, per-source telemetry, CPU/GPU engine assets |
| 0.3.0 | Current | Progressive startup, engine readiness feedback, and release-version consistency |
| 0.3.x | Next | Crash recovery, sidecar restart behavior, retry policy, and offline/provider failure handling |
| 0.4.x | Planned | Performance: startup time, sidecar size, memory use, long-meeting chunking, GPU/CPU selection, streaming responsiveness |
| 0.5.x | Planned | Quality validation: larger AMI/QMSum/CORAA baselines, consented internal fixtures, regression thresholds, hallucination/evidence gates |
| 0.6.x | Planned | Packaging and updates: signed Windows installer, update flow, release asset verification, install/repair UX |
| 0.7.x | Planned | Cross-platform release confidence: macOS/Linux packaging paths, audio capability checks, platform-specific fallback behavior |
| 0.8.x | Planned | Product polish: search and navigation refinements, meeting review ergonomics, export flows, settings diagnostics |
| 0.9.x | Planned | Security and privacy review: keychain audit, data-retention controls, local file permissions, dependency/license review |
| 1.0.0 | Target | Stable release: documented support matrix, reproducible release process, strong reliability/performance baseline, no critical known data-loss paths |

## Contributing

Contributions are welcome. If you are interested in AI, desktop development, or audio engineering, check out the open issues and submit a pull request. Please read [CONTRIBUTING.md](CONTRIBUTING.md) — commits must be signed off (DCO) — and follow the existing code conventions.

## License

Licensed under the [Apache License 2.0](LICENSE).

Copyright 2026 Igor Cassimiro Assunção. Redistributions and derivative works
must retain the attribution notices in the [NOTICE](NOTICE) file, as required
by Section 4 of the license.

**Trademark notice:** the Apache License does not grant permission to use the
name "AI NoteTaking" or the project logo (License, Section 6). Forks and
derivative works may not use the name or logo to identify themselves without
prior written permission.
