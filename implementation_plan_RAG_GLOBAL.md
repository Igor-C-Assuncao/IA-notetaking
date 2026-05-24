# Sprint 14 Technical Implementation Plan — Local Offline Privacy & Global RAG Chat

This document details the architectural design and file-by-file changes required to deliver Sprint 14. The goal is to provide a 100% local, offline Retrieval-Augmented Generation (RAG) assistant called **AI Copilot** that allows users to ask questions, discover connections, and converse with their entire meeting history right from a glassmorphic sidebar chat panel.

---

## Goal Description
Introduce a fully local RAG engine using a selectable embedding strategy: either a running local **Ollama Embeddings API** or a lightweight self-contained Python **Sentence-Transformers ONNX** model. The raw transcripts and summaries are chunked, embedded, and indexed into a robust, lightweight vector engine managed by Python. An automated background indexing sync indexes newly recorded meetings immediately, while a one-time backfill indices past database records on startup. A gorgeous, interactive chat sidebar in the Expanded View enables conversational question-answering with clickable meeting source citations.

---

## User Review Required

> [!NOTE]
> **Zero-Dependency Vector Index in Python:**
> To guarantee bulletproof installation on Windows without relying on complex, binary-compiling C++ native modules (like SQLite-VSS, Chroma, or duckdb which often break during Python wheel installations), we will implement a lightning-fast, NumPy-based cosine-similarity vector store in Python. It indexes paragraphs/sentences into memory and saves/loads them from a local JSON/binary cache. It performs sub-millisecond retrieval on thousands of entries with zero external DLL dependencies!

> [!IMPORTANT]
> **Model Downloading Indicator:**
> If the user selects the "Local HuggingFace" embedding strategy, a lightweight sentence-transformer model (e.g., `all-MiniLM-L6-v2`, ~90MB) will be downloaded on first startup. We will implement a clear visual loader ("Downloading embedding weights...") in the settings tab to keep the user informed.

---

## Proposed Changes

```mermaid
graph TD
    subgraph Frontend (React / TypeScript)
        A[ExpandedView Layout] -->|Toggle UI| B[CopilotSidebar Panel]
        B -->|Message Input| C[useRAG Hook]
        C -->|Tauri Command| D[Tauri ask_copilot]
        E[Citation Click] -->|Selects History Row| F[ExpandedView Meeting Detail]
    end

    subgraph Rust Tauri (lib.rs)
        D -->|JSON stdin command| G[Python main.py]
        H[BufReader Thread] -->|Parses COPILOT_RESPONSE| C
        I[Tauri DB backfill] -->|JSON index command| G
    end

    subgraph Python Backend (main.py)
        G -->|RAG Query| J[rag_service.py]
        J -->|Cosine Similarity| K[NumPy Vector Cache]
        G -->|Auto-Index / Backfill| L[Generate Embeddings]
        L -->|Ollama / SentenceTransformers| J
        J -->|Context Retrieval| M[llm_service.py]
        M -->|Streaming Response| H
    end
```

---

### 1. Database & Settings Strategy

#### [MODIFY] [SettingsProvider.tsx](file:///c:/implementation/IA-notetaking/src/app/providers/SettingsProvider.tsx)
Expand standard settings with RAG-specific properties including provider, embedding model, and database sync status.

```typescript
export interface Settings {
  // ... existing settings ...
  ragEnabled: boolean;
  ragProvider: "ollama" | "local";
  ragEmbeddingModel: string; // e.g. "nomic-embed-text" or "all-MiniLM-L6-v2"
  ragHistorySynced: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  // ... existing settings ...
  ragEnabled: true,
  ragProvider: "ollama",
  ragEmbeddingModel: "nomic-embed-text",
  ragHistorySynced: false,
};
```

---

### 2. Rust Backend updates

#### [MODIFY] [lib.rs](file:///c:/implementation/IA-notetaking/src-tauri/src/lib.rs)
1. **Implement RAG-related Commands:**
   - `ask_copilot(state, query, system_prompt, provider, model, api_key)`: Sends standard `COPILOT_QUERY` payload to Python stdin.
   - `trigger_index_backfill(state)`: Queries SQLite for all past meetings (IDs, raw transcripts, titles, dates), packages them, and dispatches `BACKFILL_INDEX_REQUESTED` to Python stdin.
2. **Handle Python RAG Responses:**
   - Intercepts `COPILOT_STREAM` and `COPILOT_COMPLETED` events in the stdout BufReader thread and broadcasts them to the React frontend.
3. **Register Commands:**
   - Add new commands to `tauri::generate_handler![...]`.

---

### 3. Python Backend Updates

#### [NEW] [rag_service.py](file:///c:/implementation/IA-notetaking/src-python/rag_service.py)
Create a clean, isolated local Vector Index service:
- **Chunking:** Splits transcripts into overlapping logical windows (e.g., 200 words, 50 words overlap) while preserving meeting IDs, titles, dates, and timestamp ranges.
- **Embedding Generation:**
  - *Ollama strategy:* Requests embedding vectors using `/api/embeddings`.
  - *Local strategy:* Imports and executes standard `sentence_transformers` or ONNX embeddings dynamically.
- **Similarity Search:** Stores vectors as a lightweight NumPy array `[N, D]` mapped to chunk indices, and calculates Cosine Similarity scores. Returns top-K matched chunks with meeting IDs, speaker attributions, and timestamps.
- **Persistence:** Persists vector weights and chunk records into a secure cache `vector_index.json` or `.npy` file inside `src-python/` or standard app data directories.

#### [MODIFY] [main.py](file:///c:/implementation/IA-notetaking/src-python/main.py)
1. **Handle `INDEX_MEETING`:**
   - Triggers when a new recording finishes or reprocessing finishes. Chunks the raw text, generates embeddings, updates `vector_index.npy`, and saves the cache.
2. **Handle `BACKFILL_INDEX_REQUESTED`:**
   - Receives full meeting history array from Rust, iterates and chunks each record, embeds, builds the vector database, and saves it. Emits `BACKFILL_INDEX_COMPLETED` with counts.
3. **Handle `COPILOT_QUERY`:**
   - Retrieves the user query.
   - Triggers vector similarity search to pull Top 5 relevant chunks across all meetings.
   - Formats a comprehensive system prompt: "You are the AI Copilot. Synthesize an answer based on the following meeting transcript contexts. Always cite meetings by date and title using brackets like [Meeting Title](date)..."
   - Streams the LLM tokens (`COPILOT_STREAM` event) to Tauri, ending with `COPILOT_COMPLETED`.

---

### 4. Interactive Glassmorphic UI Panel

#### [NEW] [CopilotSidebar.tsx](file:///c:/implementation/IA-notetaking/src/features/rag/components/CopilotSidebar.tsx)
A gorgeous, slide-out glassmorphic panel matching the rest of the Liquid Glass notebook aesthetics:
- **Header:** Title "AI Copilot" with a clean toggle button, connection status indicator (Ollama/Local state), and clear-chat icon.
- **Message List:** Displays a chat timeline with separate User and Assistant bubbles.
  - Supports Markdown rendering for summaries and bold texts.
  - Automatically turns cited source brackets (e.g. `[Weekly Sync](2026-05-22)`) into interactive glass pill buttons that automatically select and open that specific meeting detail in the main list.
- **Status Indicator:** Shows typing/indexing activity (e.g., "AI is searching history...", "Thinking...").
- **Footer Input:** Includes a modern glass chat bar with auto-resizing text field, character indicator, and custom send icon.

#### [MODIFY] [ExpandedView.tsx](file:///c:/implementation/IA-notetaking/src/widgets/ExpandedView.tsx)
Embed the `CopilotSidebar` directly into the expanded main view layout:
- Add a sleek floating "Copilot" toggle button in the sidebar panel.
- Implement flex positioning so that when toggled open, the Copilot chat slides in elegantly from the right, squishing the main notes sheet with a gorgeous cubic-bezier transition, maintaining layout responsiveness.

---

### 5. Settings Integration

#### [MODIFY] [PopoverWidget.tsx](file:///c:/implementation/IA-notetaking/src/widgets/PopoverWidget.tsx)
Introduce a brand new tab/section: **AI Copilot & Privacy**
- **Settings Toggle:** Enable/Disable RAG indexing.
- **Strategy Selector:** Choose between "Ollama (Runs through your local Ollama API)" and "Local Engine (Self-contained sentence-transformers model)".
- **Sync Timeline Info:** Displays indexing statistics (e.g. "Total indexed segments: 342 across 12 meetings").
- **Sync History Action:** Displays a prominent button "Sync Past Meeting History" to trigger the Tauri backfill indexer if it wasn't run, along with a nice progress bar.

---

## Verification Plan

### Automated Tests
- Run `cargo check` inside `src-tauri` to verify Rust builds correctly.
- Run `npm run build` to confirm TSX and CSS assets package cleanly without linter issues.

### Manual Verification
1. **Backfill Indexing:** Click "Sync Past Meeting History" inside settings popover. Verify that the Python backend splits transcripts, generates embeddings successfully, and prints status updates to the stdout logs.
2. **Context-Aware RAG Conversation:** Ask the Copilot a specific question about a past meeting (e.g., "What did we decide about Sprint 13 Notion integration?").
   - Verify that the assistant retrieves matching segments.
   - Verify that the assistant prints source citations accurately.
3. **Citation Redirection:** Click on a generated source pill citation in the chat panel. Verify that the expanded view instantly switches its active selected history card to the referenced meeting detail.
4. **Offline Strategy Switch:** Toggle between "Ollama" and "Local" models inside settings and verify that querying still performs embeddings and returns correct, accurate results.
