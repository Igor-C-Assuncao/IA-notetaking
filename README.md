<div align="center">
  <img src="public/logo-mark-white.png" alt="AI NoteTaking" width="160" />

  <h1>AI NoteTaking</h1>

  <p>An open-source, invisible, privacy-first AI notetaker for your meetings.</p>

  [![Version](https://img.shields.io/badge/Version-0.2.0-informational.svg)](https://github.com/Igor-C-Assuncao/IA-notetaking/releases)
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
- **Evidence-backed meeting intelligence** — decisions and action items include confidence, inference labels, exact transcript quotes, and links back to timestamped source segments.
- **Meeting briefing dashboard** — cross-meeting continuity reports: recurring topics, decision changes, and related meetings surfaced before you join the next call.
- **Live processing feedback** — reprocessing reports staged progress in real time (context preparation, token estimation, AI calls, chunking, finalization) with elapsed time and token/billing status per provider.
- **Per-source audio monitoring** — separate live level meters for microphone and system audio, so you can see at a glance which sources are actually being captured.
- **Reliable configuration** — provider-specific credentials, explicit save behavior, recoverable validation errors, and Hugging Face gated-model access checks.
- **Compact floating widget** — sits as a small always-on-top pill while you work; expands to the full view when you need to review notes or browse meeting history.
- **Persistent history** — every session, structured summary, and versioned transcript segment set is saved locally in SQLite.
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

### Quality validation snapshot

These runs validate benchmark infrastructure, report generation, release gates,
and selected early baselines. Mock and smoke rows are not production-quality
claims.

#### Validation and smoke checks

The deterministic `example-001` fixture validates the scorer and report pipeline:

| Metric | Score |
|---|---:|
| Weighted overall score | 1.000 |
| Word error rate | 0.000 |
| Character error rate | 0.000 |
| Decision precision | 1.000 |
| Action-item precision | 1.000 |
| Explicit assignee accuracy | 1.000 |
| Evidence quote validity | 1.000 |
| Critical-claim hallucination rate | 0.000 |
| Pipeline completion rate | 1.000 |
| Human factuality | 5.0 / 5 |
| Human usefulness | 5.0 / 5 |

Latest validation runs:

| Mode | Run | Commit | Result |
|---|---|---|---|
| Generated prediction artifacts (`--prediction-mode mock`) | `2026-06-16_135711_69308fe` | `69308fe` | PASS, weighted score `1.000` |
| Precomputed prediction scoring | `2026-06-16_135712_69308fe` | `69308fe` | PASS, weighted score `1.000` |

All configured release gates pass for this fixture. Speaker attribution was not
measured. These values verify benchmark correctness and must not be treated as a
production-quality baseline.

#### Early real baseline

| Dataset | Mode | Run | Commit | Result |
|---|---|---|---|---|
| AMI `IB4001` | ASR, Ollama `llama3`, `--gate-profile asr` | `2026-06-16_211950_14bc2e7` | `14bc2e7` | PASS, weighted score `0.924`, WER `0.258`, CER `0.200`, latency `68.428s` |

The AMI row is a single-fixture transcription baseline and should be treated as
an early signal only. Representative AMI, QMSum, CORAA, consented internal
meeting fixtures, and larger LLM-generated QMSum runs are still required.

## Release history

### 0.2.0 (current)

- Meeting briefing intelligence pipeline and briefing dashboard UI
- Real-time reprocess progress (`REPROCESS_STATUS` events: staged progress, elapsed time, token estimates, provider/model info)
- Per-source audio telemetry (mic vs system levels) with the new `AudioInputMeter` component
- Recording pipeline reliability fixes: captured audio is no longer dropped, near-silent recordings are rejected before transcription
- Project licensing formalized: Apache 2.0 `LICENSE` + `NOTICE`, SPDX headers on all sources, DCO adopted for contributions, `CITATION.cff`

### 0.1.0

- Initial release: loopback + microphone capture, Silero VAD, WhisperX transcription, LangGraph summaries
- BYOK multi-provider support (Ollama, OpenAI, Gemini, Anthropic) with keychain-stored secrets
- Compact floating widget, expanded view, meeting history in SQLite, two themes

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
| 7 — Evidence and quality gates | ✅ Active | Frontend, Python, Rust, benchmark fixtures, regression tests, and packaged-sidecar validation |
| 8 — Meeting intelligence | ✅ Shipped in 0.2.0 | Briefing dashboard, cross-meeting continuity, follow-up drafts, chaptering, participation analytics |
| 9 — Runtime observability | ✅ Shipped in 0.2.0 | `REPROCESS_STATUS`, per-source audio telemetry, token estimates, staged progress, quiet-audio rejection |
| 10 — Engine distribution | 🚧 In progress | Windows CPU engine release asset, split GPU engine assets, release manifest, runtime download/install flow |
| 11 — Release hardening | ⏳ Next | Code signing, installer validation, update flow, cross-platform release bundles, broader benchmark coverage |
| 12 — v1.0 readiness | ⏳ Planned | Privacy/security review, model/provider compatibility matrix, documentation freeze, reproducible release process |

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
