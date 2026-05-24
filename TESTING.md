# 🧪 Quality Assurance & Test Suite Manual

This document serves as the official operational reference for running, maintaining, and verifying Sprints 16's comprehensive multi-tier test suites.

---

## 🏗️ Testing Architecture Overview

Our test architecture spans all three major components of the invisible private assistant:

```
                  ┌──────────────────────────────┐
                  │      React Frontend UI       │
                  │   (Vitest + RTL + JSDOM)     │
                  └──────────────┬───────────────┘
                                 │ Mock IPC Bridge
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Tauri Core (Rust)                         │
│                    (cargo test + In-Memory)                     │
└────────────────────────────────┬────────────────────────────────┘
                                 │ Subprocess Stdin/Stdout
                                 ▼
                  ┌──────────────────────────────┐
                  │      Python AI Sidecar       │
                  │   (pytest + mock + cov)      │
                  └──────────────────────────────┘
```

---

## 1. 💻 React Frontend Tests

Our React UI leverages **Vitest** for speed, **JSDOM** to mock the browser DOM, and **React Testing Library (RTL)** for component mounting and click interactions.

### 📋 Coverage Scope
*   **Markdown Parsers (`parsers.test.ts`):** **100% Coverage** guaranteed for TL;DR and checklist regex extractions.
*   **Feature Hooks:** **>75% Coverage** covering lifecycle transitions, timer calculations, and IPC data synchronization:
    *   `useRecording.test.ts` (Idle -> Recording -> Paused states)
    *   `useTranscription.test.ts` (Chunk streams and text filtering)
    *   `useSummary.test.ts` (Outcome derivatives and parse mappings)
    *   `useMeetings.test.ts` (Retriever and debounced searches via fake timers)
*   **Sample Component (`Toggle.test.tsx`):** Confirms click transitions, Space/Enter keyboard triggers, and disabled states.

### 🚀 Execution Commands
Run these commands from the workspace root:

```powershell
# 1. Run all frontend tests once
npm run test

# 2. Run in interactive watch mode
npm run test:watch

# 3. Launch the beautiful Vitest Graphical UI in browser
npm run test:ui

# 4. Generate coverage reports (Terminal + HTML index in /coverage)
npm run test:coverage
```

---

## 2. 🦀 Rust Core Database Tests

Our Tauri engine database tests leverage standard **Cargo test** harnesses running against an ephemeral **in-memory SQLite connection**, avoiding filesystem pollution.

### 📋 Coverage Scope
*   **Idempotent Migrations:** Verifies that calling `initialize_db_schema()` repeatedly executes without warnings or panics.
*   **Meetings CRUD:** Asserts that inserting raw transcripts correctly persists rows and returns valid indices.
*   **Chronological Ordering:** Confirms meetings are retrieved in descending order (newest first).
*   **FTS5 Full-Text Queries:** Tests SQLite's virtual FTS5 tables matching terms across titles and raw transcripts with wildcard support.

### 🚀 Execution Commands
Run this command from the `src-tauri` directory:

```powershell
# Run all Rust database tests
cd src-tauri
cargo test
```

---

## 3. 🐍 Python AI Sidecar Tests

Our Python sidecar runs on **pytest** featuring deep mocks for language models, hardware processors, and voice activity segmentations.

### 📋 Coverage Scope
*   **LangGraph Services (`test_llm_service.py`):** **>=85% Coverage** testing all analytical graph nodes in isolation (extraction, cleanup, decisions, executive outline) with JSON fallback routes.
*   **WhisperX fallbacks (`test_transcription_service.py`):** **>=75% Coverage** verifying NVIDIA CUDA, Apple Silicon MPS, and CPU fallback pathways, alongside token diarization omissions.
*   **Voice Activity (`test_vad_service.py`):** **>=75% Coverage** confirming segment isolation for flat zero-signals and active speech.
*   **E2E Integration (`test_integration.py`):**
    *   *IPC Handshake:* Spawns a real python subprocess and executes stdin/stdout handshake.
    *   *Pipeline Test:* Transcribes a real Portuguese `.wav` audio fixture in under 60 seconds.

### 🚀 Execution Commands
Run these commands from the `src-python` directory (ensure your virtual environment is active):

```powershell
# Activate virtual environment
.venv\Scripts\activate

# 1. Run standard unit tests (Skips slow E2E audio pipeline by default)
pytest -v --cov=. --cov-report=term-missing -m "not slow"

# 2. Run all tests including slow E2E integration pipeline
pytest -v
```

---

## 📊 Quality Summary & Target Gates

| Tier | Tooling | Coverage Gate | Slow Test Config |
| :--- | :--- | :--- | :--- |
| **Frontend** | Vitest + JSDOM | `>= 75%` (100% Parsers) | None |
| **Rust DB** | Cargo test | `100%` Query Logic | None |
| **Python** | pytest + cov | `>= 85%` LLM, `>= 75%` AI | `@pytest.mark.slow` |
