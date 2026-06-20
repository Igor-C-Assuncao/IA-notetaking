# Product UX and AI Quality Recommendations

Last reviewed: June 11, 2026

## Purpose

This document preserves the findings from two independent reviews:

1. Product engineering and UX/UI review of onboarding and settings.
2. AI engineering review of transcription, summaries, decisions, and action items.

The findings are based on this repository, public product patterns, and accessibility guidance. They do not rely on private knowledge from any company.

## Executive Priorities

### P0: Prevent incorrect or destructive behavior

- Never summarize or save a failed transcription as meeting content.
- Isolate API keys by provider so switching providers cannot associate the wrong credential.
- Validate access to the gated Pyannote model, not only Hugging Face account identity.
- Do not discard unsaved settings when the settings window loses focus.

### P1: Make AI output evidence-based

- Preserve immutable timestamped transcript segments.
- Extract decisions and actions from the raw transcript, not an LLM-rewritten transcript.
- Keep source evidence through the final schema and UI.
- Stop inferring owners, deadlines, rationale, priority, or engagement unless the result is explicitly marked as inferred.
- Validate model output against typed schemas.

### P1: Make configuration understandable and recoverable

- Use descriptive actions such as `Connect OpenAI`, `Download model`, and `Re-check access`.
- Show pending, success, failure, and retry states.
- Add onboarding progress and a final setup review.
- Use one clear primary action per step.
- Support keyboard and screen-reader navigation.

## Approved Product Decisions

- AI may infer owners, deadlines, priorities, and rationale.
- Every inferred value must be labeled and include a confidence score.
- Transcript segments will initially be stored in versioned SQLite JSON columns.
- Settings will require explicit `Save changes`; sensitive configuration will not auto-save.
- Confidence will be visible using High, Medium, and Low labels, with optional numeric detail.
- Local meeting-content encryption is part of the planned implementation.
- Delivery will use independently releasable milestones.

## UX/UI Findings

### Credential isolation

Changing providers in settings can leave the previous provider's API key in local state. Saving may store that key for the newly selected provider.

Relevant files:

- `src/widgets/PopoverWidget.tsx`
- `src/app/providers/SettingsProvider.tsx`

Recommendation:

- Maintain credentials by provider.
- Clear or reload the visible credential when provider selection changes.
- Require successful validation before replacing an existing saved credential.
- Never display an existing secret as plaintext.

### Hugging Face and Pyannote access

`/api/whoami-v2` proves that a token is valid, but does not prove that the account accepted the terms for the gated Pyannote model.

Recommended states:

- `Token verified`
- `Checking model access`
- `Model access confirmed`
- `Terms acceptance required`
- `Service unavailable`

Recommended actions:

- `Open model page`
- `Re-check access`
- `Continue without speaker names`

Do not show `Diarization enabled` until actual model access is confirmed.

### Settings save and close behavior

Settings currently close on focus loss. This is dangerous when the user opens documentation, a password manager, or another application.

Recommendation:

- Track whether settings are dirty.
- Do not close on blur while settings are dirty.
- On explicit close, present `Discard changes` and `Keep editing`.
- Show `Saving...` while persistence is running.
- Close only after persistence succeeds.
- On failure, retain edits and show an inline retry action.

Recommended footer:

```text
Shortcuts                         Cancel   Save changes
```

### Onboarding structure

Recommended flow:

1. AI processing
2. Provider or local model setup
3. Audio device and microphone test
4. Optional speaker identification
5. Review and finish

The review should state:

- AI provider and model
- Local or cloud processing
- What meeting data leaves the device
- Selected microphone
- Speaker identification readiness
- Any missing optional configuration

### Button hierarchy

Use one primary action per state.

Examples:

| State | Primary action | Secondary action |
|---|---|---|
| Cloud key missing | `Connect OpenAI` | `Back` |
| Ollama unavailable | `Re-check Ollama` | `Download Ollama` |
| Model missing | `Download model` | `Choose another model` |
| Hugging Face empty | `Continue without speaker names` | `Back` |
| Hugging Face entered | `Verify and continue` | `Clear token` |
| Setup complete | `Finish setup` | `Back` |

Avoid showing both `Skip for now` and `Skip & Continue`.

### Accessibility

- Replace clickable selection `<div>` elements with native radio controls.
- Connect every label using `htmlFor` and an input `id`.
- Use visible keyboard focus states.
- Implement proper tab and tabpanel semantics in settings.
- Use `role="alert"` for failures.
- Use `role="status"` and `aria-live="polite"` for progress and success.
- Give icon-only buttons accessible names.
- Use semantic `<progress>` for model downloads.

### Settings information architecture

Recommended sections:

- General
- Audio
- AI and Models
- Integrations
- Privacy and Data
- Advanced

Move diagnostics, reset, RAG indexing, custom prompts, and logs out of general behavior settings.

### Privacy language

Avoid absolute claims such as `100% private`.

Preferred language:

> Meeting processing stays on this device when local AI is selected. Cloud providers and enabled integrations receive only the data required for those features.

## AI Quality Findings

### Failed transcription contract

The transcription service currently encodes failures in the transcript text. Downstream code can summarize and persist the error message.

Recommendation:

```json
{
  "ok": false,
  "error": {
    "code": "MODEL_NOT_LOADED",
    "message": "The transcription model could not be loaded."
  },
  "text": "",
  "segments": []
}
```

Downstream summarization and persistence must require `ok: true`.

### Immutable evidence model

Preserve an evidence object throughout the pipeline:

```json
{
  "segment_id": "seg_0042",
  "speaker_id": "spk_01",
  "speaker_name": null,
  "start_ms": 128400,
  "end_ms": 133100,
  "text": "I will send the proposal Friday.",
  "confidence": 0.87,
  "uncertain_words": []
}
```

The cleaned transcript should be a presentation layer. It must never replace the raw evidence used for extraction.

### Evidence-backed actions and decisions

Recommended action schema:

```json
{
  "task": "Send the proposal",
  "assignee": "Alex",
  "due_date": "2026-06-12",
  "status": "open",
  "evidence_segment_ids": ["seg_0042"],
  "evidence_quote": "I will send the proposal Friday.",
  "confidence": 0.91,
  "inference": false
}
```

Recommended decision schema:

```json
{
  "decision": "Use PostgreSQL for the service",
  "rationale": null,
  "owner": null,
  "evidence_segment_ids": ["seg_0081"],
  "evidence_quote": "We will use PostgreSQL for the service.",
  "confidence": 0.96,
  "inference": false
}
```

Unknown values should remain `null`.

Inference exception:

- The app may provide an inferred value when it is useful.
- The schema must set `inference: true`.
- The output must include confidence and supporting evidence.
- Low-confidence inference must not be presented as a confirmed commitment.

### Reliable extraction pipeline

1. Transcribe into timestamped words and segments.
2. Preserve the raw transcript.
3. Chunk by speaker turns and time windows with overlap.
4. Extract candidate claims from raw segments.
5. Verify that quoted evidence exists.
6. Verify that each claim is entailed by its evidence.
7. Deduplicate and reconcile claims globally.
8. Generate narrative summaries from verified claims.
9. Render every important claim with `View in transcript`.

### Long meetings

Do not split at a character midpoint.

Recommended behavior:

- Split on speaker-turn or sentence boundaries.
- Keep timestamp ranges and segment IDs.
- Use configurable token-aware chunk sizes.
- Add overlap between adjacent chunks.
- Run a global reconciliation pass.
- Track omissions and conflicts.

### Structured output validation

- Use Pydantic models for Python-side validation.
- Use provider-native structured output where available.
- Validate enums, dates, evidence IDs, and participant references.
- Retry once with validation feedback.
- Return an explicit partial-result state if repair fails.

### Model configuration

- Use temperature `0` for extraction and verification.
- Keep a separate configurable temperature for narrative summaries.
- Support transcription profiles such as `Fast`, `Balanced`, and `Best`.
- Use the configured Whisper model instead of a hard-coded model.
- Support vocabulary hints from participant names, project names, acronyms, and user glossaries.
- Cache alignment and diarization models.

### Product output improvements

Add sections for:

- Executive outcome
- Decisions
- Action items
- Open questions
- Risks and blockers
- Unresolved topics
- Metrics and commitments
- Follow-up suggestions

Each claim should expose evidence and uncertainty.

### Speaker workflow

- Preserve anonymous speaker IDs.
- Allow users to rename speakers after transcription.
- Persist speaker mappings.
- Apply mappings to transcript and summary views.
- Never assign a real name solely from weak LLM inference without marking it as inferred.

## Evaluation Program

Use a mixed benchmark:

- AMI for end-to-end meeting audio, transcripts, timestamps, and speakers.
- QMSum for meeting-summary coverage and evidence spans.
- CORAA for spontaneous Brazilian Portuguese transcription.
- MeetingBank only as an optional long-meeting benchmark because of its restrictive license.
- PublicHearingBR as an optional Portuguese summary benchmark after license verification.
- At least 10 consented internal Portuguese meetings with human reference annotations.

Initial fixture target:

- 10 AMI meetings
- 30 QMSum meetings
- 10 CORAA samples
- 10 internal Portuguese meetings

Score the application from 0 to 100:

| Category | Weight |
|---|---:|
| Transcription quality | 25% |
| Speaker attribution | 15% |
| Summary factuality and coverage | 30% |
| Decisions and actions | 20% |
| Robustness and performance | 10% |

The versioned evaluation set should cover:

- English and Portuguese
- Code switching
- Different accents
- Background noise
- Overlapping speech
- Technical vocabulary
- Short and 1-3 hour meetings
- Explicit, ambiguous, and absent action items

Track:

- Word error rate
- Named-entity error rate
- Diarization error rate
- Speaker-attribution accuracy
- Action and decision precision/recall
- Assignee and due-date accuracy
- Evidence quote validity
- Claim entailment
- Summary factual consistency
- Summary coverage
- Long-meeting omission rate
- Latency, memory, and provider cost

ROUGE and BERTScore are secondary metrics. They must not replace evidence validation, factuality scoring, or human review.

Every release candidate should include a machine-generated benchmark report and a double-reviewed human evaluation sample.

## Security and Privacy

- Meeting transcripts and RAG chunks currently require stronger data controls.
- Add retention settings and per-meeting RAG exclusion.
- Document where data is stored and which providers receive it.
- Encrypt sensitive local meeting content using an encryption key protected by the OS keychain.
- Define backup, migration, recovery, and key-loss behavior before enabling encryption by default.
- Never log API keys, Hugging Face tokens, or transcript content by default.

## Public References

- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Notion connection management](https://www.notion.com/help/add-and-manage-connections-with-the-api)
- [OpenAI data controls](https://help.openai.com/en/articles/7730893-data-controls-faq)
