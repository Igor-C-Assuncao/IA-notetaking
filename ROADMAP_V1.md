# AI NoteTaking — v1.0 Release Roadmap

> Sprint plan from current state (Sprint 9 done) to public v1.0 release.
> Each card is self-contained and ready to import as a GitHub Project item.

---

## Decisions captured

| # | Decision | Choice |
|---|---|---|
| 1 | Default Ollama model | `gemma4:e2b` (with `e4b` available in picker for stronger hardware) |
| 2 | i18n PT/EN | Deferred to v1.1 |
| 3 | API key storage | OS keychain via `keyring` crate (Rust command bridge) |
| 4 | Code signing | Free path: macOS ad-hoc + Windows via SignPath.io OSS program / unsigned fallback |
| 5 | Whisper model | Bundled `whisper-base` in installer (~140MB) |
| 6 | Linux support | First-class in v1.0 |
| 7 | Notion / Obsidian export | In v1.0 |
| 8 | Re-process meeting | With different prompt **and** different LLM provider |

---

## Sprint overview

| Sprint | Focus | Est. duration |
|---|---|---|
| 10 | First-Run Onboarding & Pre-Configuration | 1 week |
| 11 | Smart Agent v2 (Prompt Engineering) | 1.5 weeks |
| 12 | Frontend Refactor (App.tsx → Feature-Sliced) | 1 week |
| 13 | Power Features: Re-process & Exports | 1 week |
| 14 | Cross-Platform: Linux Support | 1 week |
| 15 | Hardening & Security | 1 week |
| 16 | Testing | 1.5 weeks |
| 17 | CI/CD, Packaging & Release v1.0 | 1 week |

**Total estimate:** ~9 weeks of focused work to v1.0.

---

# Sprint 10 — First-Run Onboarding & Pre-Configuration

Goal: Replace the current "open the app and figure it out" flow with a guided wizard that leaves the app in a known-good state on first run.

---

### [Core] Centralize Default Configuration

**Labels:** core, refactor · **Priority:** P1

```markdown
**Context:** Default values for provider, model, temperature, language and
inference parameters are scattered across `llm_service.py`,
`transcription_service.py`, and the `App.tsx` initial useState calls. This
makes it impossible to change a default without hunting through three layers.

**Task:** Create a single source of truth for defaults on each side and
wire all current consumers to read from it.

### Acceptance Criteria
- [ ] Create `src-python/config.py` exporting `DEFAULTS` dict with keys:
      `provider`, `model`, `temperature`, `num_predict`, `num_ctx`, `top_p`,
      `repeat_penalty`, `language`, `whisper_model`.
- [ ] Create `src/shared/config/defaults.ts` mirroring the Python defaults
      for frontend usage.
- [ ] Replace hardcoded defaults in `LLMFactory.get_provider()` and
      `MeetingWorkflowEngine.__init__` with `DEFAULTS` lookups.
- [ ] Replace `useState("ollama")`, `useState("llama3")` etc. in App.tsx
      with `DEFAULTS.provider`, `DEFAULTS.model`.
- [ ] Frontend defaults file is the source consumed by the onboarding wizard
      (Card 10.2) — no more magic strings.
- [ ] Add commit: `refactor(core): centralize defaults in config module`.

**Depends on:** —
```

---

### [AI] Update Default Model to Gemma 4 E2B

**Labels:** ai, config · **Priority:** P1

```markdown
**Context:** Current default is `llama3` (no tag, no quantization specified).
For the v1.0 release we want a model that runs well on consumer hardware
(8GB VRAM target) with strong PT-BR support and a context window large
enough for medium-length meetings.

**Task:** Set Gemma 4 E2B as the canonical local default and update the
inference config to match SLM best practices.

### Acceptance Criteria
- [ ] `DEFAULTS["model"] = "gemma4:e2b"` in `config.py`.
- [ ] `MeetingWorkflowEngine` inference parameters updated:
      `temperature=0.2`, `num_predict=2048`, `num_ctx=16384`,
      `top_p=0.9`, `repeat_penalty=1.1`.
- [ ] Update Ollama optgroup in popover model picker to include:
      `gemma4:e2b` (default), `gemma4:e4b`, `gemma3:4b`, `gemma3:1b`,
      `phi4:14b`, `qwen3:4b`. Remove `llama3`, `llama3.1`, `mistral`.
- [ ] Add tooltip/hint per model: VRAM requirement and best use case
      (e.g. "E2B — fast, 8GB VRAM, balanced quality").
- [ ] Validate the exact Ollama tag at install time (in Card 10.4) before
      committing to the string in code.
- [ ] Add commit: `feat(ai): set gemma4:e2b as default model with tuned config`.

**Depends on:** Card 10.1
```

---

### [UX] First-Run Onboarding Wizard Shell

**Labels:** ux, onboarding · **Priority:** P0

```markdown
**Context:** Right now the app boots straight to the compact widget with
default (often invalid) settings. New users have no path from "I just
installed this" to "it works".

**Task:** Build the wizard container that detects first run, owns step
navigation, and gates the main app behind successful completion.

### Acceptance Criteria
- [ ] On boot, read `onboarding_completed: boolean` from `settings.json`.
- [ ] If false (or missing), render `<OnboardingWizard />` instead of the
      compact widget. Window resizes to 720x540 for the wizard.
- [ ] Wizard owns step state with prev/next/skip buttons in a fixed footer.
- [ ] Steps are pluggable (5 steps in Cards 10.4–7.7); shell only orchestrates.
- [ ] Final step writes `onboarding_completed: true` and emits
      `onboarding-finished` event so the main window resizes back and
      transitions to compact.
- [ ] Wizard uses the same theme tokens as the rest of the app (default
      Liquid Glass until step 7.7 lets the user choose).
- [ ] ESC closes the wizard with confirmation ("Skip setup? Defaults will
      be used; you can reconfigure later in Settings.").
- [ ] Add commit: `feat(ux): scaffold first-run onboarding wizard`.

**Depends on:** Card 10.1
```

---

### [UX] Onboarding Step: Provider Selection

**Labels:** ux, onboarding · **Priority:** P0

```markdown
**Context:** The biggest fork in the user's experience is local-vs-cloud.
This step has to make the trade-off legible without overwhelming.

**Task:** Build the provider choice step with two clear paths: Local
(Ollama, recommended) and Cloud (BYOK).

### Acceptance Criteria
- [ ] Two large cards side-by-side: "Run locally" (Ollama) and "Use cloud"
      (with sub-options: OpenAI, Gemini, Anthropic).
- [ ] Each card shows 3 bullets: cost, privacy, hardware/network needs.
      Local: "Free · 100% private · Needs Ollama installed".
      Cloud: "Pay-per-use · Data leaves your machine · Works on any hardware".
- [ ] Selecting Local routes to Card 10.4. Selecting Cloud expands to
      provider sub-picker, then routes to Card 10.5.
- [ ] Selection persisted to wizard state but NOT to settings yet
      (committed only on wizard completion).
- [ ] Add commit: `feat(ux): onboarding step for provider selection`.

**Depends on:** Card 10.3
```

---

### [UX] Onboarding Step: Local Model Setup with Ollama Detection

**Labels:** ux, onboarding, ai · **Priority:** P0

```markdown
**Context:** If the user picks Ollama, we need to verify it's installed,
list models they already have, and offer to pull the default if missing.
Without this, "Local" silently fails on first recording.

**Task:** Detect Ollama at `localhost:11434`, query `/api/tags`, render
the model state, and pull the default model if absent.

### Acceptance Criteria
- [ ] On step mount, ping `GET http://localhost:11434/api/tags` with 2s timeout.
- [ ] If Ollama is unreachable: show "Ollama not detected" with a prominent
      link to https://ollama.com/download and a "Re-check" button.
- [ ] If reachable: list installed models. If `gemma4:e2b` (default from
      Card 10.9) is already present, mark "Ready" and enable Next.
- [ ] If default model is absent: show "Download recommended model
      (gemma4:e2b, ~1.5GB)" button that calls `POST /api/pull` and renders
      a real-time progress bar by streaming the NDJSON response.
- [ ] Allow advanced users to pick a different model from a dropdown
      (populated from `/api/tags`). Selection is saved as `model` in wizard state.
- [ ] If a chosen model is not yet installed, the same pull flow applies.
- [ ] Add commit: `feat(ux): ollama detection and model pull in onboarding`.

**Depends on:** Card 10.4, Card 10.9
```

---

### [UX] Onboarding Step: Cloud API Key Validation

**Labels:** ux, onboarding · **Priority:** P0

```markdown
**Context:** Today, an invalid API key surfaces only when the user tries
to record. We want it caught at setup time with a clear error.

**Task:** For each cloud provider, perform a lightweight API call with
the entered key to validate it before allowing wizard advance.

### Acceptance Criteria
- [ ] Show a single password-masked input for API key + "Validate" button.
- [ ] Validation endpoints (cheapest call per provider):
      - OpenAI: `GET /v1/models` (lists models, 200 OK = valid).
      - Anthropic: `POST /v1/messages` with 1-token request and `max_tokens=1`.
      - Gemini: `GET /v1beta/models` with key as query param.
- [ ] Loading spinner while validating; success shows green check + masked
      key preview ("sk-...XYZ4"). Failure shows specific error message
      ("Invalid key" vs "Rate limited" vs "Network error").
- [ ] Next is disabled until validation passes.
- [ ] Key persisted to wizard state in plaintext (Sprint 15 will move
      to keychain). Mark with TODO comment for traceability.
- [ ] Add commit: `feat(ux): cloud api key validation in onboarding`.

**Depends on:** Card 10.4
```

---

### [UX] Onboarding Step: HuggingFace Token (Optional)

**Labels:** ux, onboarding, ai · **Priority:** P1

```markdown
**Context:** Speaker diarization (pyannote.audio) requires a HuggingFace
token with model access agreements accepted. Today there's no UI for it
at all, which is why diarization silently fails.

**Task:** Add an opt-in step that explains diarization, links to model
agreements, accepts the token, and validates it.

### Acceptance Criteria
- [ ] Step is marked "Optional — for speaker identification".
- [ ] Three short bullets explaining what diarization does and the cost
      (slower processing, requires HF token, requires agreement on
      pyannote/segmentation-3.0 + pyannote/speaker-diarization-3.1).
- [ ] Two links: "Get HuggingFace token" → hf.co/settings/tokens,
      "Accept model terms" → hf.co/pyannote/speaker-diarization-3.1.
- [ ] Password-masked input + "Validate" button. Validation call:
      `GET https://huggingface.co/api/whoami` with `Authorization: Bearer <token>`.
- [ ] On valid token, show user's HF username as confirmation.
- [ ] "Skip for now" button always available; sets `speaker_diarization: false`
      in wizard state.
- [ ] Add commit: `feat(ux): huggingface token step in onboarding`.

**Depends on:** Card 10.3
```

---

### [UX] Onboarding Step: Theme & Audio Device

**Labels:** ux, onboarding · **Priority:** P1

```markdown
**Context:** Final step before completion — pick visual theme and confirm
the input device works. The level meter gives instant feedback that
mic permission is granted and audio is flowing.

**Task:** Render theme picker + device dropdown + live level meter.

### Acceptance Criteria
- [ ] Two theme cards: "Liquid Glass (dark)" and "Minimalist Notebook (light)".
      Selecting a card immediately applies the theme to the wizard.
- [ ] Device dropdown populated by emitting `LIST_DEVICES` to Python sidecar
      and listening for `DEVICE_LIST`.
- [ ] Live level meter (reuses existing `popover-level-bar` component)
      driven by `VAD_TELEMETRY` events.
- [ ] "Test microphone" button starts a 5-second silent capture so the
      level meter actually animates without saving anything.
- [ ] Final "Finish setup" button commits all wizard state to
      `settings.json`, sets `onboarding_completed: true`, and triggers
      window resize back to compact widget.
- [ ] Add commit: `feat(ux): theme and device step in onboarding`.

**Depends on:** Card 10.3
```

---

### [Core] Settings: Reset Onboarding Action

**Labels:** core, ux · **Priority:** P3

```markdown
**Context:** Useful for QA, for users moving to a new machine, and for
testing the wizard without manually editing the JSON store.

**Task:** Add a "Reset setup" button in the settings popover that clears
the onboarding flag and reopens the wizard.

### Acceptance Criteria
- [ ] Settings popover gets a new "Advanced" collapsible section at the bottom.
- [ ] Inside: red "Reset onboarding" button with confirmation dialog
      ("This will reopen the setup wizard. Your meetings will not be deleted.").
- [ ] On confirm: set `onboarding_completed: false`, close popover,
      window relaunches in wizard mode.
- [ ] Add commit: `feat(core): reset onboarding action in settings`.

**Depends on:** Card 10.3
```

---

# Sprint 11 — Smart Agent v2 (Prompt Engineering)

Goal: Move the LangGraph agent from "transcribe and bullet-list" to "understand the meeting". Each node has a specific reasoning task and feeds the next.

---

### [AI] LangGraph Node 1: Entity & Context Extraction

**Labels:** ai, langgraph · **Priority:** P0

```markdown
**Context:** Today the agent treats the transcript as a flat blob. To
produce summaries that correctly attribute statements, resolve numbers,
and turn relative dates into absolute ones, we need a first pass that
extracts structured entities upfront.

**Task:** Add a new `extract_entities_node` as the first node in the
graph (before cleanup). Output is a structured JSON consumed by all
downstream nodes.

### Acceptance Criteria
- [ ] New node `extract_entities_node(state)` runs before `cleanup`.
- [ ] Updates `AgentState` with new field `entities: dict` shaped:
      ```
      {
        "speakers": [{"name": str, "role_hint": str | null,
                      "first_mention_idx": int}],
        "numbers": [{"value": str, "context": str, "category": str}],
                   // category ∈ "money", "percentage", "duration",
                   //            "headcount", "date", "other"
        "dates": [{"raw": str, "iso": str, "context": str}],
        "projects": [str],
        "acronyms": [{"term": str, "expansion": str | null}]
      }
      ```
- [ ] Prompt instructs model: speakers come from explicit naming
      ("I'm João", "Maria, what's your view?") OR diarization labels;
      relative dates ("next Friday") are resolved using the
      `meeting_date` injected into the state from `main.py`.
- [ ] Robust JSON parsing: strip markdown fences, retry once on parse
      failure, fall back to empty entities dict on second failure
      (graph continues — entities are enrichment, not blocker).
- [ ] Add commit: `feat(ai): entity extraction node in langgraph`.

**Depends on:** Card 10.1
```

---

### [AI] LangGraph Node 2: Speaker-Aware Transcript Cleanup

**Labels:** ai, langgraph · **Priority:** P1

```markdown
**Context:** The current cleanup node strips fillers but loses speaker
attribution. With diarization, we have `SPEAKER_00/01/...` labels that
should be replaced with real names from Node 1's entity extraction.

**Task:** Rewrite `clean_transcript_node` to be speaker-aware and to
preserve turn-taking when diarization data is present.

### Acceptance Criteria
- [ ] Node receives `state.entities` and `state.diarized_segments` (when
      diarization ran).
- [ ] When diarization is available: produce a clean transcript formatted as
      `**SpeakerName (or Speaker N):** utterance` per turn, with fillers
      removed but content preserved.
- [ ] Speaker label substitution: if Node 1 extracted a name and the
      first utterance from that speaker label matches the introduction
      pattern, substitute the SPEAKER_NN label with the real name globally.
- [ ] Negations are NEVER reframed (no "we won't ship" → "we will ship").
      Add explicit instruction in prompt + 2 few-shot examples covering this.
- [ ] When diarization is not available: behaves exactly as the current
      node (plain cleanup) so backwards compatibility holds.
- [ ] Add commit: `feat(ai): speaker-aware transcript cleanup`.

**Depends on:** Card 11.1
```

---

### [AI] LangGraph Node 3: Decision & Action Extraction with Grounding

**Labels:** ai, langgraph · **Priority:** P0

```markdown
**Context:** Current `extract_action_items_node` produces a bulleted list
without grounding — the model can hallucinate owners or due dates.
Decisions and actions are also conflated. We need to separate them and
require each item to cite the source quote.

**Task:** Rewrite the node to produce structured decisions and actions,
each grounded in a transcript quote.

### Acceptance Criteria
- [ ] Node updates `AgentState` with two new fields:
      ```
      decisions: [{"text": str, "source_quote": str}]
      actions:   [{"who": str|null, "what": str, "due": str|null,
                   "source_quote": str}]
      ```
- [ ] `who` MUST come from `state.entities.speakers` — prompt says
      "If no name from the speakers list applies, set who=null".
- [ ] `due` is the ISO date from `state.entities.dates` when the source
      quote contains a relative or absolute date phrase.
- [ ] `source_quote` is a verbatim ≤25-word substring of the cleaned
      transcript. Validate post-generation: if quote is not actually a
      substring, drop the item with a warning log.
- [ ] Prompt distinguishes decisions (concrete choices made: "we'll go
      with Postgres") from discussions (open questions, opinions).
      Include 2 few-shot examples per category.
- [ ] Empty arrays are valid output and explicitly allowed.
- [ ] Add commit: `feat(ai): grounded decision and action extraction`.

**Depends on:** Card 11.1, Card 11.2
```

---

### [AI] LangGraph Node 4: Executive Summary with Numerical Narrative

**Labels:** ai, langgraph · **Priority:** P0

```markdown
**Context:** Current summary node produces a generic markdown. Now that
we have entities, decisions, and grounded actions, the final summary
should weave numbers and participants into the narrative.

**Task:** Rewrite `generate_summary_node` to consume the structured
state and produce a richer markdown output.

### Acceptance Criteria
- [ ] Output `final_markdown` has these sections in order:
      1. `## TL;DR` — 1–2 sentences, MUST include at least one key number
         from `state.entities.numbers` if any exist.
      2. `## Participants` — bulleted list from `state.entities.speakers`
         with role hints when present.
      3. `## Key Decisions` — from `state.decisions`, formatted as
         `- **Decision:** text  \n  *"source quote"*`.
      4. `## Action Items` — checkbox list `- [ ] {who}: {what} (by {due})`.
      5. `## Numbers & Metrics` — only if `state.entities.numbers` is
         non-empty; bulleted list with category badges.
      6. `## Tags` — 2–5 lowercase hyphenated topic tags.
- [ ] `structured_summary` JSON output preserves all fields for the DB
      column (already exists).
- [ ] System prompt prefix from user settings is still respected at the
      top of this node's prompt (existing behavior).
- [ ] Add commit: `feat(ai): executive summary with numerical narrative`.

**Depends on:** Card 11.1, Card 11.2, Card 11.3
```

---

### [AI] Map-Reduce Strategy for Long Meetings

**Labels:** ai, langgraph · **Priority:** P1

```markdown
**Context:** Gemma 4 E2B has effective ~16K context. Reuniões de 60+ min
em PT geram ~12K–20K tokens — começa a estourar. Cloud models também
beneficiam de chunking pra manter qualidade.

**Task:** Add a conditional subgraph: when transcript token count
exceeds threshold, split → run nodes 1 & 3 per chunk → reduce.

### Acceptance Criteria
- [ ] Token estimation helper: 1 token ≈ 4 chars for EN, 3 chars for PT.
      Configurable via `DEFAULTS.tokens_per_char`.
- [ ] Threshold: if estimated tokens > `num_ctx * 0.6`, take map-reduce path.
- [ ] Chunk strategy: split by silence gaps (using VAD segments saved
      during transcription) into ~8K-token chunks with 500-token overlap.
- [ ] Map phase: run Node 1 (entities) + Node 3 (decisions/actions) per
      chunk in parallel using `langgraph` parallel branches if supported,
      else sequentially.
- [ ] Reduce phase: merge entities (dedupe by name/value), concatenate
      decisions and actions, then run Node 4 once on the merged state
      with cleaned-transcript-as-summary-of-summaries.
- [ ] Logs each stage with chunk index and token count.
- [ ] Add commit: `feat(ai): map-reduce strategy for long meetings`.

**Depends on:** Card 11.4
```

---

### [AI] Few-Shot Prompts Library (PT-BR & EN)

**Labels:** ai, prompts · **Priority:** P1

```markdown
**Context:** SLMs like Gemma 4 E2B benefit substantially from few-shot
examples. Embedding examples inline in Python strings is unmaintainable.

**Task:** Extract all prompts and examples to a versioned `prompts/`
directory with separate files per language.

### Acceptance Criteria
- [ ] New directory `src-python/prompts/` with structure:
      ```
      prompts/
      ├── entity_extraction.en.md
      ├── entity_extraction.pt.md
      ├── transcript_cleanup.en.md
      ├── transcript_cleanup.pt.md
      ├── decisions_actions.en.md
      ├── decisions_actions.pt.md
      └── executive_summary.en.md
      └── executive_summary.pt.md
      ```
- [ ] Each `.md` file has front-matter sections: `## Instruction`,
      `## Output Format`, `## Few-Shot Examples` (2–3 examples each).
- [ ] PT-BR examples are realistic: standup-style meetings, sprint
      planning, sales calls. EN examples mirror these.
- [ ] `prompts/__init__.py` exports `load_prompt(name: str, lang: str)`
      that reads the file at startup, caches in memory.
- [ ] LangGraph nodes call `load_prompt("entity_extraction", lang)` based
      on detected transcript language (default: English).
- [ ] Add commit: `feat(ai): few-shot prompts library with pt-br and en`.

**Depends on:** Card 11.1, Card 11.2, Card 11.3, Card 11.4
```

---

### [AI] Inference Config Tuning for SLM Quality

**Labels:** ai, config · **Priority:** P2

```markdown
**Context:** Default `temperature=0.1` was set when target was Llama 3.
Gemma 4 behaves differently — too low and it loops; too high and it
confabulates speakers. Needs empirical tuning.

**Task:** Per-node inference parameter overrides, validated against a
fixture set of recordings.

### Acceptance Criteria
- [ ] `MeetingWorkflowEngine` accepts `node_overrides: dict[str, dict]`
      mapping node name → inference param dict.
- [ ] Defaults defined in `config.py`:
      ```
      NODE_INFERENCE = {
        "entity_extraction": {"temperature": 0.1, "top_p": 0.85},
        "transcript_cleanup": {"temperature": 0.2, "top_p": 0.9},
        "decisions_actions":  {"temperature": 0.1, "top_p": 0.85},
        "executive_summary":  {"temperature": 0.3, "top_p": 0.9},
      }
      ```
- [ ] Each node passes its override to `self.llm.bind(**params)` before
      `.invoke()`.
- [ ] Manual validation: run all 4 nodes against a curated 15-min fixture
      meeting (PT and EN) with `gemma4:e2b` 5x — JSON parse rate ≥95%.
- [ ] Add commit: `feat(ai): per-node inference parameter tuning`.

**Depends on:** Card 11.1, Card 11.2, Card 11.3, Card 11.4
```

---

# Sprint 12 — Frontend Refactor

Goal: Break the 1164-line `App.tsx` into a Feature-Sliced architecture. No new functionality — purely structural.

---

### [Quality] Migrate to Feature-Sliced Architecture

**Labels:** refactor, quality · **Priority:** P1

```markdown
**Context:** `App.tsx` mixes 4 root-level components (Root, App,
PopoverWindowContent, SettingsModal), 11 useState hooks, 5 useEffect
blocks, OS detection helpers, IPC handlers, parsers, and JSX rendering.
At 1164 lines it can't be tested in isolation and any change risks
breaking unrelated areas.

**Task:** Establish the Feature-Sliced directory structure as a foundation.
Subsequent cards in this sprint move concrete code into it.

### Acceptance Criteria
- [ ] Create empty directory tree:
      ```
      src/
      ├── app/         (App.tsx, Root.tsx, providers/)
      ├── features/    (recording, transcription, summary, meetings,
      │                 settings, window-chrome, onboarding)
      ├── widgets/     (CompactWidget, ExpandedView)
      ├── shared/      (ui, lib, types, config)
      └── main.tsx
      ```
- [ ] Each feature folder has `index.ts` (barrel export),
      `components/`, `hooks/`, optional `lib/`.
- [ ] `tsconfig.json` paths added: `@app/*`, `@features/*`, `@widgets/*`,
      `@shared/*`. Vite config updated with matching aliases.
- [ ] No code moved yet — this card only establishes the skeleton and
      passes `tsc --noEmit`.
- [ ] Add commit: `refactor(arch): scaffold feature-sliced directory structure`.

**Depends on:** —
```

---

### [Quality] Extract Window Chrome Components

**Labels:** refactor, ux · **Priority:** P2

```markdown
**Context:** `MacTrafficLights`, `WinCaptionButtons`, `LogoMark`,
`StatusDot`, `Toggle`, and `Waveform` are presentational and reusable.
They live at the top of `App.tsx` today.

**Task:** Move these to `shared/ui/` and `features/window-chrome/`.

### Acceptance Criteria
- [ ] `shared/ui/`: `LogoMark.tsx`, `StatusDot.tsx`, `Toggle.tsx`, `Waveform.tsx`.
- [ ] `features/window-chrome/`: `MacTrafficLights.tsx`, `WinCaptionButtons.tsx`,
      `Titlebar.tsx`.
- [ ] Each component has its own `.module.css` next to it (CSS Modules,
      see Card 12.7 for full migration).
- [ ] `detectOS` moved to `shared/lib/detectOS.ts`.
- [ ] `formatDuration` moved to `shared/lib/formatDuration.ts`.
- [ ] All imports in `App.tsx` updated; app behavior unchanged
      (smoke test: compact view renders identically).
- [ ] Add commit: `refactor(ux): extract presentational components to shared and window-chrome`.

**Depends on:** Card 12.1
```

---

### [Quality] Create Settings, Theme, and IPC Providers

**Labels:** refactor, architecture · **Priority:** P1

```markdown
**Context:** Settings state is duplicated between `App` and
`PopoverWindowContent` and synced via `settings-changed` events.
Theme is set on `document.documentElement` from two places.
IPC `listen` is registered in 4 different effects.

**Task:** Centralize each via React Context providers.

### Acceptance Criteria
- [ ] `app/providers/SettingsProvider.tsx`:
      loads `settings.json` once on mount, exposes
      `{ settings, updateSettings(partial) }` via context.
      Persists changes back to store with debounced 300ms write.
- [ ] `app/providers/ThemeProvider.tsx`: subscribes to `settings.theme`,
      sets `data-theme` attribute, exposes `useTheme()` returning
      `{ theme, isLG, waveColor }`.
- [ ] `app/providers/IpcProvider.tsx`: single `listen<string>("python-event", ...)`
      that fans out to typed event handlers. Exposes
      `usePythonEvent(eventName, callback)` hook for consumers.
- [ ] Providers wrap `<App />` in `app/Root.tsx`.
- [ ] All scattered `load("settings.json")` calls in App.tsx and
      PopoverWindowContent removed — they now read from `useSettings()`.
- [ ] Add commit: `refactor(arch): introduce settings, theme, and ipc providers`.

**Depends on:** Card 12.1
```

---

### [Quality] Type-Safe IPC Event Layer

**Labels:** refactor, types · **Priority:** P1

```markdown
**Context:** Every Python event is parsed with `JSON.parse` and accessed
via `parsed.data.<field>` with no type safety. Adding or renaming a field
silently breaks the UI.

**Task:** Define discriminated union for all Python events and a typed
parser.

### Acceptance Criteria
- [ ] `shared/types/ipc-events.ts` defines:
      ```ts
      type PythonEvent =
        | { event: "SYSTEM_READY"; data: { status: string } }
        | { event: "DEVICE_LIST"; data: { devices: AudioDevice[] } }
        | { event: "VAD_TELEMETRY"; data: { level: number } }
        | { event: "RECORDING_STATUS"; data: { is_recording: boolean } }
        | { event: "PIPELINE_STATUS"; data: { step: string } }
        | { event: "TRANSCRIPTION_COMPLETED"; data: { text: string;
              segments: DiarizedSegment[] | null; diarized: boolean } }
        | { event: "NOTES_GENERATED"; data: { markdown: string;
              structured: StructuredSummary } }
        | { event: "ERROR"; data: { message: string } };
      ```
- [ ] `shared/lib/ipc.ts` exports `parsePythonEvent(payload: string):
      PythonEvent | null` with runtime narrowing.
- [ ] `IpcProvider` consumes the parsed events; no consumer parses raw payloads.
- [ ] `invoke()` calls also typed: `shared/lib/ipc.ts` exports
      `sendCommand(cmd: PythonCommand)` with command union.
- [ ] No `any` types in IPC code path.
- [ ] Add commit: `refactor(types): type-safe ipc event layer`.

**Depends on:** Card 12.3
```

---

### [Quality] Extract Recording, Transcription, and Summary Hooks

**Labels:** refactor, hooks · **Priority:** P1

```markdown
**Context:** Recording state, transcription text, notes, and timer logic
are all in `App` as local state. They're tightly coupled to specific UI
trees but conceptually independent.

**Task:** Extract custom hooks per domain.

### Acceptance Criteria
- [ ] `features/recording/hooks/useRecording.ts`:
      exposes `{ isRecording, recordingSeconds, audioLevel,
                 toggleRecording, status }`. Owns timer + IPC
      RECORDING_STATUS + VAD_TELEMETRY listeners.
- [ ] `features/transcription/hooks/useTranscription.ts`:
      exposes `{ transcription, segments, diarized, search, setSearch,
                 filteredTranscript }`. Listens to TRANSCRIPTION_COMPLETED.
- [ ] `features/summary/hooks/useSummary.ts`:
      exposes `{ notes, tldr, actionItems, structuredSummary }`.
      Listens to NOTES_GENERATED; runs `parseActionItems` and `parseTldr` once.
- [ ] Parsers `parseActionItems` and `parseTldr` move to
      `features/summary/lib/parsers.ts` with unit tests added in Sprint 16.
- [ ] `App.tsx` consumes hooks, holds no local state for these domains.
- [ ] Add commit: `refactor(hooks): extract recording, transcription, summary hooks`.

**Depends on:** Card 12.3, Card 12.4
```

---

### [Quality] Split Compact Widget and Expanded View

**Labels:** refactor, ux · **Priority:** P2

```markdown
**Context:** Compact and expanded views are two completely different UIs
sharing only the title bar and theme tokens. They're rendered by the same
component via `if (!isExpanded)`.

**Task:** Move each to its own widget file.

### Acceptance Criteria
- [ ] `widgets/CompactWidget.tsx`: pill UI with waveform, timer, controls.
- [ ] `widgets/ExpandedView.tsx`: sidebar + main content + footer actions.
- [ ] `App.tsx` reduces to:
      ```tsx
      const isExpanded = useWindowMode();
      return isExpanded ? <ExpandedView /> : <CompactWidget />;
      ```
- [ ] `useWindowMode()` hook in `features/window-chrome/hooks/`.
- [ ] Each widget imports its own composition of feature components.
- [ ] App.tsx total length ≤ 80 lines after this card.
- [ ] Add commit: `refactor(ux): split compact widget and expanded view`.

**Depends on:** Card 12.5
```

---

### [Quality] Migrate App.css to CSS Modules

**Labels:** refactor, styling · **Priority:** P3

```markdown
**Context:** `App.css` is 32K of global selectors. Class names like
`compact-widget`, `pill-inner`, `popover-row` collide easily and have
no encapsulation guarantees.

**Task:** Move styles to colocated `.module.css` files. Keep theme
tokens and CSS variables in a single global file.

### Acceptance Criteria
- [ ] `src/app/global.css` retains: CSS variables, `:root` definitions,
      `data-theme` attribute selectors, font imports, animation keyframes.
      Maximum 200 lines.
- [ ] Each component owns its own `.module.css` (e.g.
      `CompactWidget.module.css`, `MacTrafficLights.module.css`).
- [ ] Class names are camelCase per CSS Modules convention.
- [ ] No selector collisions: `npm run build` passes; visual
      regression manually checked against pre-refactor screenshots.
- [ ] Add commit: `refactor(style): migrate to css modules`.

**Depends on:** Card 12.6
```

---

# Sprint 13 — Power Features: Re-process & Exports

Goal: Two killer features for v1.0 — re-running a meeting through a different LLM and exporting to the user's note system of choice.

---

### [AI] Re-process Meeting with Different Prompt

**Labels:** ai, feature · **Priority:** P1

```markdown
**Context:** Today, once a meeting is summarized, the user is stuck with
that summary forever. They might want a different style (bullet vs prose),
a different focus (decisions vs action items), or a different language.

**Task:** Add an IPC action to re-run the LangGraph pipeline on a
stored raw transcript with a new system prompt.

### Acceptance Criteria
- [ ] New Tauri command `reprocess_meeting(meeting_id, system_prompt,
      provider, model, api_key) -> Result<()>`.
- [ ] Command emits `REPROCESS_REQUESTED` to Python with the meeting's
      `raw_transcript` from SQLite + new prompt.
- [ ] Python `main.py` handles `REPROCESS_REQUESTED`: skips audio capture
      and transcription stages, runs only the LangGraph step.
- [ ] On completion, emits `REPROCESS_COMPLETED` with new markdown +
      structured summary.
- [ ] Rust handler updates the existing meeting row (does NOT create new):
      `UPDATE meetings SET markdown_summary=?, structured_summary=?
       WHERE id=?`. Original `raw_transcript` is never overwritten.
- [ ] Add commit: `feat(ai): reprocess meeting with different prompt`.

**Depends on:** Sprint 11 cards
```

---

### [AI] Re-process Meeting with Different LLM Provider

**Labels:** ai, feature · **Priority:** P1

```markdown
**Context:** Extension of Card 13.1 — let the user not just change the
prompt but try a completely different model (e.g. compare local Gemma
vs cloud Claude on the same transcript).

**Task:** The reprocess command from 10.1 already accepts provider/model
overrides; this card builds the UI flow and validates the cross-provider
handoff.

### Acceptance Criteria
- [ ] Reprocess flow accepts `{ provider, model, apiKey }` independent of
      current settings — does NOT mutate user's default settings.
- [ ] UI shows provider+model+prompt diff summary in the reprocess dialog
      (Card 13.3 covers UI).
- [ ] Successful cross-provider reprocess: e.g., a meeting summarized with
      `gemma4:e2b` can be reprocessed with `claude-haiku-4-5` and vice-versa
      without state corruption.
- [ ] On error (invalid API key, model unavailable), original summary is
      preserved (no DB write).
- [ ] Add commit: `feat(ai): cross-provider reprocess support`.

**Depends on:** Card 13.1
```

---

### [UX] Re-process UI in Meeting Detail View

**Labels:** ux, feature · **Priority:** P1

```markdown
**Context:** The expanded view's meeting detail (when a past meeting is
selected) needs an entry point for the reprocess feature.

**Task:** Add a "Reprocess" button + dialog to the meeting header.

### Acceptance Criteria
- [ ] Button "Reprocess" appears in `MeetingHeader` only when
      `selectedMeetingId !== null` and `!isRecording`.
- [ ] Click opens a modal with three sections:
      1. **System prompt** — textarea pre-filled with the user's current
         default prompt; user can edit.
      2. **Provider & Model** — dropdowns pre-selected to current defaults;
         user can change. Shows API key field if non-Ollama and key not set.
      3. **Preview info** — "Original: {provider} / {model} on {date}".
- [ ] "Run" button triggers `reprocess_meeting`; modal shows progress
      indicator tied to `PIPELINE_STATUS` events.
- [ ] On `REPROCESS_COMPLETED`, modal closes; meeting view refreshes
      with new summary; toast "Reprocessed with {model}".
- [ ] Original raw transcript and meeting date are preserved.
- [ ] Add commit: `feat(ux): reprocess dialog in meeting detail`.

**Depends on:** Card 13.1, Card 13.2
```

---

### [Core] Export to Obsidian-Compatible Markdown

**Labels:** feature, export · **Priority:** P1

```markdown
**Context:** Existing export is plain `.md`. Obsidian users expect
front-matter (YAML), wiki-links for participants, and tags as `#tag`
inline rather than a section.

**Task:** Add a dedicated Obsidian export option.

### Acceptance Criteria
- [ ] Footer action gets a dropdown "Export ▾" with options:
      "Markdown (.md)", "Obsidian (.md)", "Notion", "JSON".
- [ ] Obsidian variant produces:
      ```yaml
      ---
      title: "Meeting on 2026-04-28"
      date: 2026-04-28
      participants: ["[[João]]", "[[Maria]]"]
      tags: [meeting, q2-planning]
      ---
      ```
      Followed by the markdown body where every speaker name is
      `[[Name]]` and every tag becomes `#tag` at the end.
- [ ] Inline action items use Obsidian Tasks plugin syntax:
      `- [ ] {what} 📅 {due_iso} 👤 [[{who}]]`.
- [ ] Save dialog defaults to `{vault}/Meetings/` if `obsidian_vault_path`
      is set in settings (new optional setting in popover).
- [ ] Add commit: `feat(export): obsidian-compatible markdown export`.

**Depends on:** Sprint 11
```

---

### [Core] Export to Notion via API

**Labels:** feature, export · **Priority:** P2

```markdown
**Context:** Notion is the most-requested integration after raw markdown.
We can do it via Notion's API without an OAuth flow if the user provides
an internal integration token.

**Task:** Add a Notion integration token field in settings + export action
that creates a new page in a chosen database.

### Acceptance Criteria
- [ ] New settings (in popover, "Integrations" section, collapsed by default):
      `notion_token` (password input), `notion_database_id` (text input)
      with help link to integration setup docs.
- [ ] Token validation button: `GET https://api.notion.com/v1/users/me`
      with `Authorization: Bearer <token>` and `Notion-Version: 2022-06-28`.
- [ ] Database ID validation: `GET /v1/databases/{id}` returns 200.
- [ ] Export action creates a page with:
      - Title: meeting title
      - Properties: Date (date), Tags (multi-select), Participants
        (multi-select using entity-extracted speakers)
      - Body: markdown summary converted to Notion blocks (use existing
        markdown→blocks conversion library, e.g. `martian`).
- [ ] On success, show toast with "Open in Notion" button (deep link
      `notion://www.notion.so/{page_id}`).
- [ ] Token stored in keychain (Sprint 15) — for now, settings.json
      with TODO comment.
- [ ] Add commit: `feat(export): notion integration with internal token`.

**Depends on:** Sprint 11
```

---

### [Core] Export Structured JSON (Power Users)

**Labels:** feature, export · **Priority:** P3

```markdown
**Context:** For users who want to pipe meetings into other tools
(custom scripts, Zapier, Make.com, n8n).

**Task:** Add JSON export option that dumps the full structured summary.

### Acceptance Criteria
- [ ] Dropdown option "JSON (.json)" exports a file shaped:
      ```json
      {
        "meta": {
          "id": 42,
          "date": "2026-04-28T14:30:00Z",
          "title": "...",
          "duration_seconds": 1820,
          "provider": "ollama",
          "model": "gemma4:e2b"
        },
        "transcript": { "raw": "...", "diarized": [...] },
        "summary": { "tldr": "...", "decisions": [...], "actions": [...],
                     "tags": [...], "markdown": "..." },
        "entities": { "speakers": [...], "numbers": [...], "dates": [...] }
      }
      ```
- [ ] Export filename: `meeting_{id}_{yyyy-mm-dd}.json`.
- [ ] Schema documented in `docs/EXPORT_SCHEMA.md`.
- [ ] Add commit: `feat(export): structured json export`.

**Depends on:** Sprint 11
```

---

# Sprint 14 — Cross-Platform: Linux Support

Goal: Make Linux a first-class target. The current `audio_capture.py` factory only handles macOS and Windows; Linux needs a strategy implementation.

---

### [Core] Linux Audio Capture: Microphone via PulseAudio/PipeWire

**Labels:** core, linux · **Priority:** P0

```markdown
**Context:** Most modern Linux distros ship PipeWire (with PulseAudio
compatibility layer). The `soundcard` library already in requirements.txt
abstracts this — we need a `LinuxAudioCapture` class wired into the factory.

**Task:** Implement `LinuxAudioCapture` for microphone input.

### Acceptance Criteria
- [ ] New class `LinuxAudioCapture` in `src-python/audio_capture.py`,
      mirroring the interface of the macOS/Windows implementations
      (`start_recording`, `stop_recording`, telemetry callback).
- [ ] Uses `soundcard.default_microphone()` and chunks 16kHz mono frames
      into the same VAD pipeline.
- [ ] Device enumeration via `soundcard.all_microphones()` populates
      `list_audio_devices()` correctly with `type: "mic"`.
- [ ] Telemetry callback fires at the same rate as other platforms (~50ms).
- [ ] Manual test: recording on Ubuntu 24.04 + Fedora 40 produces a valid
      WAV file that VAD and Whisper can process.
- [ ] Add commit: `feat(linux): microphone capture via soundcard`.

**Depends on:** —
```

---

### [Core] Linux Audio Capture: System Loopback via Monitor Source

**Labels:** core, linux · **Priority:** P0

```markdown
**Context:** PipeWire / PulseAudio expose system audio as a "monitor"
source — every output device has a corresponding `<sink>.monitor`
input. This is the Linux equivalent of macOS ScreenCaptureKit and
Windows WASAPI loopback.

**Task:** Capture system audio via monitor sources, mix with mic stream.

### Acceptance Criteria
- [ ] `LinuxAudioCapture` detects monitor sources via
      `pactl list sources short` (parsed) or `soundcard.all_microphones(
      include_loopback=True)`.
- [ ] When `system_audio=True`, opens both mic and monitor sources,
      mixes into a single 16kHz mono frame with normalized levels
      (50/50 mix, configurable later).
- [ ] Device list includes monitor sources marked `type: "loopback"`.
- [ ] Falls back gracefully if no monitor source available (e.g., no
      audio output sink): emits `WARNING` event "System audio
      unavailable" and proceeds with mic-only.
- [ ] Manual test: Zoom call on Linux, system_audio toggle on,
      recording captures both sides with comparable volumes.
- [ ] Add commit: `feat(linux): system loopback via monitor source`.

**Depends on:** Card 14.1
```

---

### [Core] Update AudioCaptureFactory for Linux

**Labels:** core, linux · **Priority:** P0

```markdown
**Context:** The factory currently has only mac/win branches.

**Task:** Add Linux branch and update platform detection.

### Acceptance Criteria
- [ ] `AudioCaptureFactory.get_strategy()` adds:
      ```python
      elif sys.platform.startswith("linux"):
          return LinuxAudioCapture()
      ```
- [ ] Raises clear error on unsupported platforms (e.g. FreeBSD)
      instead of falling through silently.
- [ ] README architecture table updated to list Linux strategy.
- [ ] Add commit: `feat(linux): wire linux strategy into factory`.

**Depends on:** Card 14.1, Card 14.2
```

---

### [Infra] Linux Build Configuration in Tauri

**Labels:** infra, linux · **Priority:** P1

```markdown
**Context:** `tauri.conf.json` doesn't have Linux-specific config yet.
AppImage is the most portable distribution format.

**Task:** Configure Tauri to build AppImage and `.deb` for Linux.

### Acceptance Criteria
- [ ] `tauri.conf.json` `bundle.linux`:
      ```json
      {
        "appimage": { "bundleMediaFramework": false },
        "deb": { "depends": ["libwebkit2gtk-4.1-0", "libpulse0"] }
      }
      ```
- [ ] `bundle.targets` configured per-OS or kept as `"all"` with
      conditional CI logic (Sprint 17).
- [ ] Local `npm run tauri build` on Ubuntu 24.04 produces a working
      AppImage that launches the app and runs through onboarding.
- [ ] Add commit: `infra(linux): tauri build config for appimage and deb`.

**Depends on:** Card 14.3
```

---

# Sprint 15 — Hardening & Security

Goal: Resolve security and robustness issues that any reviewer of the v1.0 release will find.

---

### [Security] Migrate API Keys to OS Keychain via keyring

**Labels:** security · **Priority:** P0

```markdown
**Context:** API keys (OpenAI, Anthropic, Gemini) are stored in
plaintext in `settings.json` via `tauri-plugin-store`. For an open
source release, this is a security smell that will be flagged immediately.

**Task:** Use the Rust `keyring` crate to store keys in the OS keychain
(macOS Keychain, Windows Credential Manager, Linux Secret Service).

### Acceptance Criteria
- [ ] Add `keyring = "3"` to `Cargo.toml`.
- [ ] New Tauri commands:
      `set_secret(key: String, value: String) -> Result<()>`,
      `get_secret(key: String) -> Result<Option<String>>`,
      `delete_secret(key: String) -> Result<()>`.
- [ ] Commands use service name `"com.opensource.ainotetaker"` and the
      `key` param as the entry name (e.g. `"openai_api_key"`,
      `"anthropic_api_key"`, `"gemini_api_key"`, `"hf_token"`,
      `"notion_token"`).
- [ ] Frontend `useSettings` hook reads/writes secrets via these
      commands instead of `settings.json` for the keys above.
- [ ] One-time migration on app start: if any of these keys exist in
      `settings.json`, move to keychain and clear the JSON entry.
      Migration is idempotent.
- [ ] Add commit: `feat(security): migrate api keys to os keychain`.

**Depends on:** Sprint 10 (onboarding writes the initial keys)
```

---

### [Security] Migrate HuggingFace Token to Keychain

**Labels:** security · **Priority:** P1

```markdown
**Context:** Same threat model as API keys.

**Task:** Use the same keychain commands for HF token.

### Acceptance Criteria
- [ ] HF token stored under key name `"hf_token"`.
- [ ] Onboarding step (Card 10.6) writes via `set_secret`.
- [ ] Settings popover reads via `get_secret` and re-saves via `set_secret`.
- [ ] Migration from existing `settings.json` covered by Card 15.1's
      migration step.
- [ ] Add commit: `feat(security): migrate hf token to keychain`.

**Depends on:** Card 15.1
```

---

### [Core] Plumb HuggingFace Token to Diarization Pipeline

**Labels:** core, bugfix · **Priority:** P0

```markdown
**Context:** Critical bug: `transcription_service.py::_diarize` accepts
`hf_token` but `main.py::START_RECORDING` never reads it from settings
nor passes it to `transcribe()`. As a result, the speaker diarization
toggle silently always fails.

**Task:** Read the HF token from keychain in Python and pass it through
the pipeline.

### Acceptance Criteria
- [ ] On `START_RECORDING`, Python reads `hf_token` from keychain via
      a new IPC request: emits `REQUEST_SECRET("hf_token")`, Rust
      responds via stdin with `SECRET_RESPONSE("hf_token", value)`.
      (Alternative: pass token in the START_RECORDING payload directly,
      since Rust already has keychain access — simpler, prefer this.)
- [ ] `current_config["hf_token"]` populated and forwarded to
      `transcriber.transcribe(..., hf_token=current_config["hf_token"])`.
- [ ] If `speaker_diarization=True` and `hf_token` is empty, emit
      `WARNING` event "Diarization requires HF token; skipping" and
      proceed without diarization (do not silently no-op).
- [ ] Manual test on a 2-speaker recording: diarization actually runs
      and produces `SPEAKER_00` / `SPEAKER_01` segments.
- [ ] Add commit: `fix(core): plumb hf token to diarization pipeline`.

**Depends on:** Card 15.1, Card 15.2
```

---

### [Core] Python Sidecar Auto-Restart on Crash

**Labels:** core, reliability · **Priority:** P1

```markdown
**Context:** If the Python sidecar dies (OOM during a long recording,
exception in a node, model load failure), the app becomes a zombie:
the UI is up but no commands work.

**Task:** Detect sidecar death, restart with backoff, surface state to UI.

### Acceptance Criteria
- [ ] Rust `lib.rs` spawns the sidecar in a supervisor task. Watches
      stdin write errors and child process exit status.
- [ ] On unexpected exit: emit `SIDECAR_DOWN` event to frontend, attempt
      restart with exponential backoff (1s, 2s, 4s; max 3 tries).
- [ ] Each restart attempt emits `SIDECAR_RESTARTING` with attempt number.
- [ ] On successful restart, emit `SIDECAR_UP`. After 3 failures, emit
      `SIDECAR_FAILED` and surface a UI banner with "Reconnect"
      button that triggers a manual restart.
- [ ] Frontend status badge changes color/text based on these events.
- [ ] Recording state is NOT auto-resumed after restart (user must start
      again — partial buffer is unreliable).
- [ ] Add commit: `feat(core): python sidecar auto-restart on crash`.

**Depends on:** —
```

---

### [Core] Structured Logging (Rust + Python)

**Labels:** core, observability · **Priority:** P2

```markdown
**Context:** Today both layers `print` to stderr unstructured. Hard to
debug user-reported issues.

**Task:** Adopt structured logging with rotating file output.

### Acceptance Criteria
- [ ] Rust: add `tracing` + `tracing-appender`. Logs go to
      `{app_data_dir}/logs/app.log` (daily rotation, 7-day retention).
- [ ] Python: replace `print(..., file=sys.stderr)` calls with
      `logging` module. Two handlers: stderr (Rust still consumes for
      IPC line parsing — only `print(json.dumps(event))` lines remain
      on stdout) and a rotating file at `{app_data_dir}/logs/python.log`.
- [ ] Log levels: ERROR for failures, WARN for fallbacks, INFO for
      stage transitions, DEBUG for verbose internals.
- [ ] New settings entry "Open logs folder" button in the popover
      "Advanced" section.
- [ ] No PII (transcript content, API keys) in log files at INFO level
      or above. DEBUG may include transcript previews truncated to 100 chars.
- [ ] Add commit: `feat(core): structured logging with rotation`.

**Depends on:** —
```

---

### [Core] Pre-flight Validation on Startup

**Labels:** core, ux · **Priority:** P2

```markdown
**Context:** Several conditions can leave the app unusable on startup
(Ollama not running, model deleted, expired API key). Today these
surface only when the user tries to record.

**Task:** Validate prerequisites at startup and surface actionable errors.

### Acceptance Criteria
- [ ] After onboarding completion / on every subsequent boot, Python
      runs a `preflight_check()` that emits `PREFLIGHT_RESULT` with:
      ```
      {
        "audio_devices": bool,
        "transcription_model_loaded": bool,
        "llm_provider_reachable": bool,
        "errors": [str],
        "warnings": [str]
      }
      ```
- [ ] If `errors` is non-empty, frontend shows a banner with the message
      and a "Fix" button that opens the relevant settings section.
- [ ] Specific checks:
      - Audio: `list_audio_devices()` returns non-empty list.
      - Transcription: WhisperX model loaded successfully (not None).
      - LLM: if Ollama, ping `localhost:11434/api/tags` and verify
        configured model exists. If cloud, defer (validated on use).
- [ ] Preflight runs in background, never blocks the UI.
- [ ] Add commit: `feat(core): preflight validation on startup`.

**Depends on:** Sprint 10
```

---

### [Infra] Auto-Updater via tauri-plugin-updater

**Labels:** infra · **Priority:** P2

```markdown
**Context:** Without an updater, every patch requires the user to manually
download and reinstall. v1.0 should ship with auto-update built in.

**Task:** Configure `tauri-plugin-updater` pointing at GitHub Releases.

### Acceptance Criteria
- [ ] Add `tauri-plugin-updater = "2"` to Cargo.toml and capability config.
- [ ] `tauri.conf.json` `plugins.updater`:
      ```json
      {
        "endpoints": ["https://github.com/Igor-C-Assuncao/IA-notetaking/releases/latest/download/latest.json"],
        "pubkey": "<generated>"
      }
      ```
- [ ] `latest.json` schema generated by the release workflow (Sprint 17).
- [ ] On startup, app checks for update; if available, shows non-blocking
      toast "Update {version} available — Install on next quit".
- [ ] User can disable auto-checks in settings ("Check for updates
      automatically" toggle).
- [ ] Updater public key generated and committed; private key stored as
      GitHub secret `TAURI_SIGNING_PRIVATE_KEY`.
- [ ] Add commit: `feat(infra): auto-updater via tauri-plugin-updater`.

**Depends on:** Sprint 17 release workflow design
```

---

# Sprint 16 — Testing

Goal: Coverage sufficient to refactor with confidence and to catch regressions in CI before they hit users.

---

### [Quality] Frontend Test Setup: Vitest + RTL + MSW

**Labels:** testing, frontend · **Priority:** P1

```markdown
**Context:** No test runner configured.

**Task:** Configure Vitest with React Testing Library and MSW for IPC mocking.

### Acceptance Criteria
- [ ] Add devDependencies: `vitest`, `@vitest/ui`, `@testing-library/react`,
      `@testing-library/user-event`, `@testing-library/jest-dom`,
      `jsdom`, `msw`.
- [ ] `vitest.config.ts` with jsdom env and path aliases matching
      `tsconfig.json`.
- [ ] `src/test/setup.ts` registers jest-dom matchers and an IPC mock
      that stubs `@tauri-apps/api/core::invoke` and `event::listen`.
- [ ] `package.json` scripts: `test`, `test:watch`, `test:ui`, `test:coverage`.
- [ ] Sample test passes: `Toggle.test.tsx` covers click toggling.
- [ ] Add commit: `chore(test): vitest, rtl, msw setup`.

**Depends on:** Sprint 12
```

---

### [Quality] Python Test Setup: pytest + coverage

**Labels:** testing, python · **Priority:** P1

```markdown
**Context:** No Python tests exist.

**Task:** Configure pytest with coverage reporting and async support.

### Acceptance Criteria
- [ ] Add to `requirements-dev.txt`: `pytest`, `pytest-cov`,
      `pytest-asyncio`, `pytest-mock`.
- [ ] `pyproject.toml` (new) with pytest config: testpaths,
      asyncio_mode=auto, coverage thresholds.
- [ ] `src-python/tests/` directory with `conftest.py` providing
      shared fixtures: `mock_llm`, `sample_transcript_pt`,
      `sample_transcript_en`, `sample_audio_path`.
- [ ] `pytest src-python/tests/` runs and reports coverage.
- [ ] Add commit: `chore(test): pytest setup with coverage`.

**Depends on:** —
```

---

### [Quality] Unit Tests: LangGraph Nodes

**Labels:** testing, ai · **Priority:** P0

```markdown
**Context:** The agent is the riskiest part of the system to refactor.

**Task:** Cover each node in isolation with mocked LLM.

### Acceptance Criteria
- [ ] `tests/test_llm_service.py` covers:
      - `extract_entities_node` with 3 transcript fixtures (PT, EN, mixed)
      - `clean_transcript_node` with diarized + non-diarized inputs
      - `decisions_actions_node` validates `source_quote` ⊆ transcript
      - `executive_summary_node` validates section ordering and inclusion
      - JSON parse failure fallback path
      - System prompt prefix is correctly prepended
- [ ] LLM is mocked via `pytest-mock` to return canned responses per node.
- [ ] Coverage: ≥85% for `llm_service.py`.
- [ ] Add commit: `test(ai): unit tests for langgraph nodes`.

**Depends on:** Card 16.2, Sprint 11
```

---

### [Quality] Unit Tests: TranscriptionService & VAD

**Labels:** testing, ai · **Priority:** P1

```markdown
**Context:** Hardware detection logic and diarization fallback paths
have multiple branches that are easy to break.

**Task:** Cover transcription and VAD paths with mocked Whisper.

### Acceptance Criteria
- [ ] `tests/test_transcription_service.py`:
      - CUDA available → device=cuda, compute_type=float16
      - CUDA fails, CPU fallback works
      - MPS available → device=mps
      - Empty audio file returns error dict
      - Missing file returns error dict
      - Diarization with valid hf_token returns segments
      - Diarization without token returns None and falls back to plain
- [ ] `tests/test_vad_service.py`:
      - Pure silence input → no speech segments
      - Pure speech input → one continuous segment
      - Mixed input → segments only over speech regions
- [ ] Coverage: ≥75% for both files.
- [ ] Add commit: `test(ai): unit tests for transcription and vad`.

**Depends on:** Card 16.2
```

---

### [Quality] Unit Tests: Frontend Hooks

**Labels:** testing, frontend · **Priority:** P1

```markdown
**Context:** Hooks extracted in Sprint 12 are the integration layer
between IPC and UI.

**Task:** Test each hook with mocked IPC.

### Acceptance Criteria
- [ ] `useRecording.test.ts`: toggle starts/stops, timer increments,
      audio level updates, status reflects pipeline events.
- [ ] `useTranscription.test.ts`: TRANSCRIPTION_COMPLETED event populates
      state, search filter works.
- [ ] `useSummary.test.ts`: NOTES_GENERATED populates notes; parsers
      called once; tldr and actionItems derived correctly.
- [ ] `useMeetings.test.ts`: history loads, search debounced (use fake
      timers), selection updates view.
- [ ] Coverage: ≥75% for all hook files.
- [ ] Add commit: `test(frontend): unit tests for feature hooks`.

**Depends on:** Card 16.1, Sprint 12
```

---

### [Quality] Unit Tests: Markdown Parsers

**Labels:** testing, frontend · **Priority:** P2

```markdown
**Context:** `parseActionItems` and `parseTldr` are pure functions —
ideal for property-based and example-based tests.

**Task:** Cover edge cases.

### Acceptance Criteria
- [ ] `parseActionItems`:
      - Standard `- [ ] task` format → matches
      - Asterisk `* [ ] task` format → matches
      - With leading/trailing whitespace → matches and trims
      - Already-checked `- [x] task` → does NOT match (only open items)
      - Empty input → empty array
      - 10 fixture summaries from real meetings → expected counts
- [ ] `parseTldr`:
      - `## TL;DR\ntext` → text
      - `## tldr\ntext` (case insensitive) → text
      - No TL;DR section → null
      - Multi-line TL;DR → joined with single space
- [ ] Coverage: 100% on parsers.
- [ ] Add commit: `test(frontend): parsers full coverage`.

**Depends on:** Card 16.1, Card 12.5
```

---

### [Quality] Rust Unit Tests: DB Commands

**Labels:** testing, rust · **Priority:** P2

```markdown
**Context:** SQLite migrations and FTS5 indexes are easy to break silently.

**Task:** Cover database commands with in-memory SQLite.

### Acceptance Criteria
- [ ] `src-tauri/src/db/tests.rs` (new module):
      - `save_meeting` inserts row, returns Ok
      - `get_meetings` returns rows in DESC order
      - `search_meetings` matches FTS5 query in title/transcript/summary
      - Migrations idempotent (run twice without error)
- [ ] In-memory connection: `Connection::open_in_memory()`.
- [ ] `cargo test` runs and passes.
- [ ] Add commit: `test(rust): db command tests with in-memory sqlite`.

**Depends on:** Card 16.2
```

---

### [Quality] Integration Test: End-to-End Pipeline with Audio Fixture

**Labels:** testing, integration · **Priority:** P1

```markdown
**Context:** Unit tests don't catch wiring bugs. We need at least one
test that runs the full pipeline against a real audio file.

**Task:** Commit a small audio fixture and a test that runs Python
sidecar end-to-end.

### Acceptance Criteria
- [ ] Add `src-python/tests/fixtures/sample_meeting_pt.wav` (~30s,
      2 speakers, recorded with permission, file size < 1MB).
- [ ] `tests/test_integration.py::test_full_pipeline`:
      - Spawns the sidecar via subprocess
      - Sends START_RECORDING (with system_audio=False, mic=fixture)
      - Stubs the audio capture to read from fixture instead of mic
      - Sends STOP_RECORDING
      - Asserts NOTES_GENERATED event arrives within 60s
      - Asserts structured summary has tldr, decisions, actions, tags fields
- [ ] Test is marked `@pytest.mark.slow` and skipped by default in
      regular CI runs; runs in `release.yml` workflow only.
- [ ] Add commit: `test(integration): end-to-end pipeline with audio fixture`.

**Depends on:** Card 16.2
```

---

# Sprint 17 — CI/CD, Packaging & Release v1.0

Goal: Automated builds, distributable artifacts, public v1.0.

---

### [Infra] GitHub Actions: CI Workflow (Lint + Test)

**Labels:** infra, ci · **Priority:** P0

```markdown
**Context:** No CI today. Every change is tested only locally.

**Task:** Workflow that runs on every PR and push to main.

### Acceptance Criteria
- [ ] `.github/workflows/ci.yml` triggered on `pull_request` and
      `push: { branches: [main] }`.
- [ ] Matrix: `ubuntu-latest`, `macos-latest`, `windows-latest`.
- [ ] Steps per OS:
      1. Setup Node 20, Rust stable, Python 3.11
      2. Install dependencies (`npm ci`, `cd src-python && pip install -r requirements.txt -r requirements-dev.txt`)
      3. Lint: `npm run lint`, `cd src-python && ruff check .`,
         `cd src-tauri && cargo clippy --all-targets -- -D warnings`,
         `cargo fmt --check`
      4. Test: `npm run test:coverage`, `pytest src-python/tests/`,
         `cd src-tauri && cargo test`
      5. Build smoke test: `npm run tauri build -- --debug`
- [ ] Artifact: coverage report uploaded.
- [ ] Required check on `main` branch.
- [ ] Add commit: `infra(ci): github actions ci workflow`.

**Depends on:** Sprint 16
```

---

### [Infra] Bundle Python Sidecar with PyInstaller

**Labels:** infra, packaging · **Priority:** P0

```markdown
**Context:** Today the user must `pip install -r requirements.txt`
manually. For v1.0 the Python runtime + dependencies must be bundled
into a self-contained binary.

**Task:** PyInstaller spec that produces a single binary per OS, wired
into Tauri's `externalBin`.

### Acceptance Criteria
- [ ] `src-python/build.spec` (PyInstaller spec file) bundles:
      - `main.py` as entry point
      - All requirements.txt deps (torch, whisperx, langgraph, etc.)
      - Whisper model weights (Card 17.3)
      - Silero VAD weights
- [ ] PyInstaller invoked with `--onefile --name ai-notetaking-engine-{os}`.
- [ ] Output binaries: `binaries/ai-notetaking-engine-{os}-{arch}` for
      `darwin-aarch64`, `darwin-x86_64`, `linux-x86_64`, `windows-x86_64`.
- [ ] `tauri.conf.json` `bundle.externalBin` updated to include the
      engine binary alongside `audio-tap`.
- [ ] `lib.rs` spawns the bundled binary instead of `python main.py`.
- [ ] Bundle size budget: ≤500MB per OS (with Whisper base).
- [ ] Add commit: `infra(packaging): pyinstaller bundle for python sidecar`.

**Depends on:** —
```

---

### [Infra] Bundle Whisper-base Model in Installer

**Labels:** infra, packaging · **Priority:** P1

```markdown
**Context:** Decision: bundle whisper-base for instant first-run.

**Task:** Pre-download the model weights and include them in the
PyInstaller bundle.

### Acceptance Criteria
- [ ] Build script step: pre-fetch
      `~/.cache/whisper/base.pt` (and aligner models) before invoking
      PyInstaller.
- [ ] PyInstaller spec includes the cache directory as a `data` entry.
- [ ] At runtime, `transcription_service.py` checks both the bundled
      cache path and the user's `~/.cache/whisper/` (in that order)
      before downloading.
- [ ] Final installer adds ~140MB; documented in CHANGELOG.
- [ ] Add commit: `infra(packaging): bundle whisper-base model`.

**Depends on:** Card 17.2
```

---

### [Infra] macOS .dmg Build (Ad-Hoc Signed, Unnotarized)

**Labels:** infra, macos · **Priority:** P0

```markdown
**Context:** No paid Apple Developer account. App must still be
installable on macOS without building from source.

**Task:** Produce a `.dmg` that runs after the user follows a documented
"first launch" workaround.

### Acceptance Criteria
- [ ] Build invokes `codesign --sign - --deep --force --options runtime
      "{app}"` for ad-hoc signing.
- [ ] `tauri.conf.json` `bundle.macOS.signingIdentity = "-"`.
- [ ] Notarization is skipped (would require a paid account).
- [ ] DMG is built for both `aarch64` (Apple Silicon) and `x86_64` (Intel),
      named `AI-NoteTaking-{version}-macos-{arch}.dmg`.
- [ ] Documentation includes the install instructions:
      "Right-click the app → Open the first time" and
      "If macOS blocks it: System Settings → Privacy & Security → Open Anyway".
- [ ] Add commit: `infra(macos): adhoc signed dmg build`.

**Depends on:** Card 17.2, Card 17.3
```

---

### [Infra] Windows .exe Build (SignPath.io OSS or Unsigned Fallback)

**Labels:** infra, windows · **Priority:** P0

```markdown
**Context:** No paid code signing certificate. SignPath.io offers free
code signing for OSS projects (https://signpath.org/foundation) which
removes the SmartScreen warning. Apply to their program; if approved,
sign via their CI integration. Otherwise, ship unsigned with documented
SmartScreen workaround.

**Task:** Produce a Windows installer with the best available signing path.

### Acceptance Criteria
- [ ] Application submitted to SignPath.io OSS program; tracking issue
      filed. (Not blocking — fallback covers v1.0 launch.)
- [ ] If SignPath approved before release: integrate their GitHub Action
      to sign the artifact post-build.
- [ ] If not approved: ship unsigned `.msi` and `.exe`. Documentation
      includes "More info → Run anyway" SmartScreen workaround.
- [ ] Build produces `AI-NoteTaking-{version}-windows-x86_64.msi`.
- [ ] Add commit: `infra(windows): exe and msi build pipeline`.

**Depends on:** Card 17.2, Card 17.3
```

---

### [Infra] Linux AppImage Build

**Labels:** infra, linux · **Priority:** P0

```markdown
**Context:** AppImage is the most portable Linux distribution format.

**Task:** Produce AppImage and `.deb` artifacts.

### Acceptance Criteria
- [ ] CI builds AppImage on `ubuntu-22.04` (older glibc for compatibility).
- [ ] `.deb` package built with declared dependencies (Card 14.4).
- [ ] AppImage is executable: `chmod +x` and run on Ubuntu 24.04 + Fedora 40
      manually validated.
- [ ] Output names: `AI-NoteTaking-{version}-linux-x86_64.AppImage`,
      `ai-notetaking_{version}_amd64.deb`.
- [ ] Add commit: `infra(linux): appimage and deb build`.

**Depends on:** Card 14.4, Card 17.2, Card 17.3
```

---

### [Infra] GitHub Actions: Release Workflow with Auto-Changelog

**Labels:** infra, ci · **Priority:** P0

```markdown
**Context:** Release process must be a single git tag operation.

**Task:** `.github/workflows/release.yml` triggered on version tags.

### Acceptance Criteria
- [ ] Workflow triggered on `push: { tags: [v*] }`.
- [ ] Matrix builds artifacts from Cards 17.4, 14.5, 14.6 in parallel.
- [ ] Generates `latest.json` for the auto-updater (Card 15.7) with
      `version`, `notes`, `pub_date`, and per-platform signatures.
- [ ] Generates changelog entry from conventional commits since the last
      tag (use `git-cliff` or `release-please`).
- [ ] Creates a GitHub Release with all artifacts attached, marked as
      pre-release if tag matches `v*-rc*` or `v*-beta*`.
- [ ] Slow integration test (Card 16.8) runs as a gate before publish.
- [ ] `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
      pulled from GitHub secrets.
- [ ] Add commit: `infra(ci): release workflow with auto-changelog`.

**Depends on:** Card 17.1, Card 17.4, Card 17.5, Card 17.6
```

---

### [Docs] CHANGELOG.md, RELEASING.md, Updated README

**Labels:** docs · **Priority:** P1

```markdown
**Context:** Public release needs proper documentation.

**Task:** Write release-grade docs.

### Acceptance Criteria
- [ ] `CHANGELOG.md` initialized with Keep-a-Changelog format. v1.0.0
      entry summarizes the journey from Sprint 0.
- [ ] `RELEASING.md` documents the manual fallback if CI fails:
      tagging, building locally, attaching artifacts, publishing.
- [ ] `README.md` updated:
      - "Getting Started" replaced with "Download" section linking to
        latest release per OS
      - Roadmap table updated to mark sprints 7–14 as Done
      - "Build from source" moved to a separate `CONTRIBUTING.md`
- [ ] `CONTRIBUTING.md` created with dev setup steps + commit convention
      (`tipo(escopo): descrição [#sprint-card]`).
- [ ] Add commit: `docs: changelog, releasing guide, updated readme`.

**Depends on:** —
```

---

### [Docs] Privacy Policy & Installation Guide for Unsigned Builds

**Labels:** docs · **Priority:** P1

```markdown
**Context:** Users will hit OS warnings on first launch. We need clear
docs that don't make them think the app is malicious.

**Task:** Privacy policy + per-OS installation guide.

### Acceptance Criteria
- [ ] `docs/PRIVACY.md`:
      - Local-first architecture statement
      - Data flow diagram (mic → VAD → Whisper → LangGraph → SQLite)
      - BYOK statement: when cloud providers are selected, data is sent
        to that provider per their terms (linked)
      - HF token usage scope (only diarization model download/auth)
      - No telemetry in v1.0
- [ ] `docs/INSTALL_MACOS.md`: ad-hoc signing first-launch workaround
      with screenshots.
- [ ] `docs/INSTALL_WINDOWS.md`: SmartScreen "More info → Run anyway"
      with screenshots.
- [ ] `docs/INSTALL_LINUX.md`: AppImage chmod + execute, .deb install.
- [ ] All linked from README.
- [ ] Add commit: `docs: privacy policy and install guides per os`.

**Depends on:** Cards 17.4, 14.5, 14.6
```

---

### [Release] v1.0.0-rc.1 Release Candidate

**Labels:** release · **Priority:** P0

```markdown
**Context:** Before tagging v1.0 final, ship a release candidate to
real users to catch issues that survived CI.

**Task:** Tag and distribute rc.1 to a small group of testers.

### Acceptance Criteria
- [ ] Tag `v1.0.0-rc.1` triggers release workflow; artifacts published
      as a GitHub pre-release.
- [ ] At least 3 testers (across mac/win/linux) install via downloaded
      artifact, complete onboarding, record a short meeting, and report
      back through a structured feedback issue template.
- [ ] Feedback collection window: 7 days.
- [ ] All P0/P1 bugs from feedback addressed before v1.0 tagging.
- [ ] Add commit: `chore(release): v1.0.0-rc.1`.

**Depends on:** Card 17.7, Card 17.8, Card 17.9
```

---

### [Release] v1.0.0 Final Release

**Labels:** release · **Priority:** P0

```markdown
**Context:** The finish line.

**Task:** Tag v1.0.0, announce.

### Acceptance Criteria
- [ ] Tag `v1.0.0` pushed; release workflow produces all artifacts.
- [ ] Release notes finalized in CHANGELOG.md and GitHub release page.
- [ ] README.md "Roadmap" section adds a v1.1 placeholder with i18n,
      telemetry opt-in, and the deferred items.
- [ ] Repository topics updated; description updated.
- [ ] Add commit: `chore(release): v1.0.0`.

**Depends on:** Card 17.10
```

---

## Notes on commit convention

All cards follow your existing convention:

```
tipo(escopo): descrição [#sprint-card]
```

Where `tipo ∈ { feat, fix, refactor, test, docs, chore, infra }` and `escopo` matches the label area (`core`, `ai`, `ux`, `linux`, etc.).

Example:
```
feat(ai): grounded decision and action extraction [#11.3]
```

---

## Open items deferred to v1.1+

- i18n (PT/EN/ES UI translations)
- Telemetry opt-in (PostHog or Sentry)
- Microsoft Store distribution (MSIX)
- Mobile companion app (out of scope)
- Real-time transcription preview (currently transcript appears only after STOP)
