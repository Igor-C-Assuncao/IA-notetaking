# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Igor Cassimiro Assunção
# src-python/llm_service.py
import sys
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from langchain_core.messages import SystemMessage, HumanMessage
import json as json_lib
import re
from difflib import SequenceMatcher
from pydantic import BaseModel
from config import DEFAULTS, load_model_manifest
from schemas import (
    ActionItem,
    ChapterExtraction,
    ClaimExtraction,
    ContinuityAnalysis,
    Decision,
    ExtractedEntities,
    FollowUpEmail,
    SCHEMA_VERSION,
    StructuredMeetingSummary,
)


# Minimum similarity for accepting a paraphrased evidence quote (see _fuzzy_match_score)
FUZZY_EVIDENCE_THRESHOLD = 0.85

LANGUAGE_RULE = (
    "LANGUAGE RULE: Detect the language of the transcript and write EVERY output text value "
    "(titles, summaries, decisions, tasks, rationale, contexts, tags, questions) in that same "
    "language. Never translate the content to English unless the transcript itself is in English. "
    "JSON keys and enum values (e.g. status, priority, category, trend) must remain in English "
    "exactly as specified by the schema."
)


def extract_json_payload(text: str) -> str:
    """
    Strips conversational LLM intros/outros and extracts a pure JSON block.
    """
    text = text.strip()
    
    # Strip markdown code blocks if present
    if "```" in text:
        parts = text.split("```")
        for part in parts[1::2]: # inspect content inside markdown blocks
            part_str = part.strip()
            if part_str.startswith("json"):
                part_str = part_str[4:].strip()
            if part_str.startswith("{") or part_str.startswith("["):
                return part_str

    # Fallback to brace matching
    start_idx = text.find("{")
    array_start_idx = text.find("[")
    
    if start_idx == -1 and array_start_idx == -1:
        return text
        
    start = start_idx if (start_idx != -1 and (array_start_idx == -1 or start_idx < array_start_idx)) else array_start_idx
    
    end = text.rfind("}") if start == start_idx else text.rfind("]")
    if end == -1:
        return text
        
    return text[start:end+1]


def parse_json_payload(text: str) -> dict | list:
    """
    Parses JSON from LLM output, allowing common local-model mistakes such as
    trailing commas before closing braces/brackets.
    """
    cleaned = extract_json_payload(text)
    try:
        return json_lib.loads(cleaned)
    except json_lib.JSONDecodeError:
        repaired = re.sub(r",\s*([}\]])", r"\1", cleaned)
        return json_lib.loads(repaired)


# ---------------------------------------------------------
# CROSS-MEETING CONTINUITY (deterministic pre-pass + ranking)
# ---------------------------------------------------------
# Looser than FUZZY_EVIDENCE_THRESHOLD: task titles get rewritten between
# meetings, while evidence quotes must stay close to the transcript.
CONTINUITY_RECURRENCE_THRESHOLD = 0.8


def _continuity_similarity(a: str, b: str) -> float:
    """
    Full-string similarity for cross-meeting matching (tasks, questions).
    Average of char and token ratios: unlike _fuzzy_match_score (windowed,
    min-based, built for quote-in-segment), paraphrases with inserted or
    inflected words ('vai conduzir' vs 'conduzirá') must still match.
    """
    na = MeetingWorkflowEngine._normalize_for_fuzzy(a)
    nb = MeetingWorkflowEngine._normalize_for_fuzzy(b)
    if not na or not nb:
        return 0.0
    char_ratio = SequenceMatcher(None, na, nb).ratio()
    token_ratio = SequenceMatcher(None, na.split(), nb.split()).ratio()
    return (char_ratio + token_ratio) / 2


def find_recurring_open_actions(
    current_actions: list,
    previous_meetings: list,
    threshold: float = CONTINUITY_RECURRENCE_THRESHOLD,
) -> list[dict]:
    """
    Deterministic pre-pass: for each OPEN action of the current meeting,
    fuzzy-match its task against the action tasks of previous meetings.
    previous_meetings items: {meeting_id, date, summary: {action_items: [...]}}.
    Returns [{task, first_seen_meeting_id, occurrences, matched_meeting_ids}]
    with occurrences >= 2 only (1 for the current meeting + matched ones).
    """
    recurring = []
    for action in current_actions or []:
        if not isinstance(action, dict):
            continue
        task = str(action.get("task") or "").strip()
        status = str(action.get("status") or "open").lower()
        if not task or status != "open":
            continue

        matched = []
        for meeting in previous_meetings or []:
            if not isinstance(meeting, dict) or meeting.get("meeting_id") is None:
                continue
            summary = meeting.get("summary")
            if not isinstance(summary, dict):
                continue
            for previous_action in summary.get("action_items") or []:
                if not isinstance(previous_action, dict):
                    continue
                previous_task = str(previous_action.get("task") or "").strip()
                if not previous_task:
                    continue
                if _continuity_similarity(task, previous_task) >= threshold:
                    matched.append((meeting.get("meeting_id"), str(meeting.get("date") or "")))
                    break  # a previous meeting counts at most once per action

        if matched:
            first_seen = min(matched, key=lambda pair: (pair[1] == "", pair[1], pair[0]))
            recurring.append({
                "task": task,
                "first_seen_meeting_id": first_seen[0],
                "occurrences": 1 + len(matched),
                "matched_meeting_ids": [meeting_id for meeting_id, _ in matched],
            })
    return recurring


def find_recurring_topics(
    current_structured: dict,
    previous_meetings: list,
    threshold: float = CONTINUITY_RECURRENCE_THRESHOLD,
) -> list[str]:
    """
    Tags (case-insensitive exact match) and open questions / unresolved topics
    (fuzzy) that appear in the current meeting AND in at least one previous one.
    """
    def _tags(structured: dict) -> list[str]:
        # Tags live under metadata.tags in full summaries and at the top level
        # in compacted ones (_compact_for_continuity) — accept both.
        metadata = structured.get("metadata") or {}
        tags = list(metadata.get("tags") or []) if isinstance(metadata, dict) else []
        tags.extend(structured.get("tags") or [])
        return [str(tag).strip() for tag in tags if str(tag).strip()]

    def _questions(structured: dict) -> list[str]:
        items = list(structured.get("open_questions") or []) + list(structured.get("unresolved_topics") or [])
        return [str(item).strip() for item in items if str(item).strip()]

    previous_tags = set()
    previous_questions = []
    for meeting in previous_meetings or []:
        summary = meeting.get("summary") if isinstance(meeting, dict) else None
        if not isinstance(summary, dict):
            continue
        previous_tags.update(tag.lower() for tag in _tags(summary))
        previous_questions.extend(_questions(summary))

    recurring = []
    seen = set()
    for tag in _tags(current_structured or {}):
        if tag.lower() in previous_tags and tag.lower() not in seen:
            seen.add(tag.lower())
            recurring.append(tag)
    for question in _questions(current_structured or {}):
        if question.lower() in seen:
            continue
        for previous_question in previous_questions:
            if _continuity_similarity(question, previous_question) >= threshold:
                seen.add(question.lower())
                recurring.append(question)
                break
    return recurring


def rank_previous_meetings(
    previous_meetings: list,
    rag_results: list,
    current_meeting_id,
    limit: int = 3,
) -> list[dict]:
    """
    Orders previous meetings by aggregated RAG chunk score (sum per meeting_id),
    then fills the remainder by recency. Annotates each pick with via:
    'rag' or 'recency'. rag_results items: {meeting_id, score, ...}.
    """
    scores: dict = {}
    for chunk in rag_results or []:
        if not isinstance(chunk, dict):
            continue
        meeting_id = chunk.get("meeting_id")
        if meeting_id is None or meeting_id == current_meeting_id:
            continue
        scores[meeting_id] = scores.get(meeting_id, 0.0) + float(chunk.get("score") or 0.0)

    eligible = [
        meeting for meeting in previous_meetings or []
        if isinstance(meeting, dict) and meeting.get("meeting_id") is not None
        and meeting.get("meeting_id") != current_meeting_id
    ]

    ranked = sorted(
        (meeting for meeting in eligible if scores.get(meeting["meeting_id"], 0.0) > 0.0),
        key=lambda meeting: scores[meeting["meeting_id"]],
        reverse=True,
    )
    ranked_ids = {meeting["meeting_id"] for meeting in ranked}
    rest = sorted(
        (meeting for meeting in eligible if meeting["meeting_id"] not in ranked_ids),
        key=lambda meeting: str(meeting.get("date") or ""),
        reverse=True,
    )

    selected = [{**meeting, "via": "rag"} for meeting in ranked]
    selected.extend({**meeting, "via": "recency"} for meeting in rest)
    return selected[:limit]


# ---------------------------------------------------------
# GRAPH STATE DEFINITION
# ---------------------------------------------------------
class AgentState(TypedDict):
    """Represents the memory/state of our LangGraph workflow."""
    raw_transcript: str
    diarized_segments: list | None
    transcript_segments: list
    meeting_date: str
    
    entities: dict
    clean_transcript: str
    decisions: list
    actions: list
    chapters: list

    final_markdown: str
    structured_summary: dict   # {tldr, decisions[], actions[], tags[]}

# ---------------------------------------------------------
# LANGGRAPH WORKFLOW ENGINE
# ---------------------------------------------------------
class MeetingWorkflowEngine:
    """
    Constructs and executes a multi-node AI workflow to process transcripts.
    Supports local (Ollama) and cloud (OpenAI, Gemini, Anthropic) models.
    """
    def __init__(
        self,
        provider_name: str,
        model_name: str,
        api_key: str = None,
        system_prompt: str = None,
        language: str = None,
    ):
        self.provider_name = provider_name.lower()
        self.model_name = model_name
        self.api_key = api_key
        # Custom system prompt injected as prefix on the final summary node
        self.system_prompt = system_prompt.strip() if system_prompt else None
        # ISO language code detected by transcription (e.g. 'pt', 'en')
        self.language = language.strip() if language and language.strip() and language != "auto" else None
        self.llm = self._initialize_llm()

    def _language_directive(self) -> str:
        """
        Explicit target-language instruction. Placed at the TOP of every prompt:
        small local models follow a concrete directive ('write in pt') far more
        reliably than the generic 'detect the language' rule in LANGUAGE_RULE.
        """
        if not self.language:
            return ""
        return (
            f"TARGET LANGUAGE: '{self.language}'. The transcript is in '{self.language}'. "
            f"Write ALL output text values in '{self.language}'. Do NOT use English "
            f"unless '{self.language}' is English.\n\n"
        )

    def _initialize_llm(self):
        """Dynamically loads the correct LangChain ChatModel based on provider."""
        print(f"DEBUG: [LangGraph] Initializing {self.provider_name.upper()} model ({self.model_name})...", file=sys.stderr)
        
        # We use temperature from config for analytical tasks to balance creativity/hallucinations
        temp = DEFAULTS["temperature"]

        if self.provider_name == "ollama":
            from langchain_ollama import ChatOllama
            return ChatOllama(model=self.model_name, temperature=temp)
            
        elif self.provider_name == "openai":
            if not self.api_key:
                raise ValueError("OpenAI API key is missing.")
            from langchain_openai import ChatOpenAI
            return ChatOpenAI(model=self.model_name, api_key=self.api_key, temperature=temp)
            
        elif self.provider_name == "gemini":
            if not self.api_key:
                raise ValueError("Gemini API key is missing.")
            from langchain_google_genai import ChatGoogleGenerativeAI
            return ChatGoogleGenerativeAI(model=self.model_name, google_api_key=self.api_key, temperature=temp)
            
        elif self.provider_name == "anthropic":
            if not self.api_key:
                raise ValueError("Anthropic API key is missing.")
            from langchain_anthropic import ChatAnthropic
            return ChatAnthropic(model=self.model_name, api_key=self.api_key, temperature=temp)
            
        else:
            raise ValueError(f"Unsupported provider: {self.provider_name}")

    def _invoke_structured(self, schema_model: type[BaseModel], messages: list) -> dict | None:
        """
        Invokes the LLM with native structured output (JSON schema enforcement).
        Returns the parsed dict, or None so callers can fall back to raw-text parsing.
        """
        try:
            structured_llm = self.llm.with_structured_output(schema_model)
            result = structured_llm.invoke(messages)
            if isinstance(result, BaseModel):
                return result.model_dump()
            if isinstance(result, dict):
                return result
            return None
        except Exception as error:
            print(
                f"DEBUG: [Structured Output] Native structured call failed ({error}); "
                "falling back to raw parsing.",
                file=sys.stderr,
            )
            return None

    # --- NODE 1: Entity Extraction ---
    def extract_entities_node(self, state: AgentState):
        print("DEBUG: [LangGraph] Node 1: Extracting entities...", file=sys.stderr)
        prompt = self._language_directive() + (
            f"Meeting date context: {state.get('meeting_date', 'Unknown')}\n\n"
            "Extract entities from this meeting transcript into a structured JSON.\n"
            "Identify speakers explicitly named, important numbers with their context and category "
            "('money', 'percentage', 'duration', 'headcount', 'date', 'other'), "
            "resolvable dates (using the meeting date context), projects, and acronyms.\n\n"
            "Return ONLY a JSON object exactly matching this schema:\n"
            "{\n"
            '  "speakers": [{"name": "string", "role_hint": "string|null", "first_mention_idx": 0}],\n'
            '  "numbers": [{"value": "string", "context": "string", "category": "string"}],\n'
            '  "dates": [{"raw": "string", "iso": "string", "context": "string"}],\n'
            '  "projects": ["string"],\n'
            '  "acronyms": [{"term": "string", "expansion": "string|null"}]\n'
            "}\n\n"
            f"{LANGUAGE_RULE}\n"
        )
        
        # If diarized segments exist, provide them as helpful context
        text_to_analyze = state["raw_transcript"]
        if state.get("diarized_segments"):
            text_to_analyze += "\n\nDIARIZATION HINTS (Speaker labels and text):\n"
            for seg in state["diarized_segments"][:20]: # just a hint from the start
                text_to_analyze += f"{seg['speaker']}: {seg['text']}\n"

        messages = [
            SystemMessage(content=prompt),
            HumanMessage(content=text_to_analyze)
        ]

        entities = self._invoke_structured(ExtractedEntities, messages)
        if entities is None:
            response = self.llm.invoke(messages)
            raw = response.content.strip()
            try:
                entities = parse_json_payload(raw)
            except Exception:
                print("DEBUG: [LangGraph] Node 1 JSON parse failed.", file=sys.stderr)
                entities = {}
            if not isinstance(entities, dict):
                entities = {}

        # Ensure safe fallback keys
        for k in ["speakers", "numbers", "dates", "projects", "acronyms"]:
            if k not in entities:
                entities[k] = []

        return {"entities": entities}

    # --- NODE 2: Speaker-Aware Transcript Cleanup ---
    def clean_transcript_node(self, state: AgentState):
        print("DEBUG: [LangGraph] Node 2: Cleaning transcript...", file=sys.stderr)
        
        base_text = state["raw_transcript"]
        diarized = state.get("diarized_segments")
        entities = state.get("entities", {})
        
        if diarized:
            # We have speaker labels, let's see if we can resolve them
            prompt = self._language_directive() + (
                "You are an editor. Reformat the diarized meeting transcript below into a readable script format.\n"
                "Fix grammar and remove conversational fillers ('uh', 'um', 'like').\n"
                "CRITICAL INSTRUCTIONS:\n"
                "1. If a speaker introduces themselves or is addressed by name, use their real name from the Entities list "
                "instead of their SPEAKER_XX label.\n"
                "2. Preserve turn-taking formatting: '**SpeakerName:** utterance'.\n"
                "3. Keep the original meaning perfectly intact. NEVER reframe negations (e.g., 'we won't ship' MUST remain negative).\n"
                "4. Keep the transcript's original language. NEVER translate the content.\n"
                "5. Return ONLY the cleaned formatted script.\n\n"
                f"ENTITIES LIST (Real Names): {json_lib.dumps(entities.get('speakers', []))}\n"
            )
            
            diarized_text = "\n".join(f"{seg['speaker']}: {seg['text']}" for seg in diarized)
            content_to_clean = diarized_text
        else:
            prompt = self._language_directive() + (
                "You are an editor. Fix grammar, typos, and remove filler words (e.g., 'uh', 'um', 'like') "
                "from the following meeting transcript. Keep the original meaning intact.\n"
                "NEVER reframe negations (e.g., 'we won't ship' MUST remain negative).\n"
                "Keep the transcript's original language. NEVER translate the content.\n"
                "Return ONLY the cleaned text."
            )
            content_to_clean = base_text

        response = self.llm.invoke([
            SystemMessage(content=prompt),
            HumanMessage(content=content_to_clean)
        ])
        return {"clean_transcript": response.content}

    # --- NODE 3: Action Item & Decision Extraction ---
    def extract_action_items_node(self, state: AgentState):
        print("DEBUG: [LangGraph] Node 3: Extracting decisions and actions...", file=sys.stderr)
        prompt = self._language_directive() + (
            "Analyze the evidence transcript and extract ONLY decisions made and action items.\n"
            "Rules:\n"
            "1. Decisions are concrete choices made (e.g., 'we will go with Postgres').\n"
            "2. Action items are explicit commitments or requests. Do not convert suggestions into tasks.\n"
            "3. Every decision and action MUST include an exact evidence_quote copied from the transcript and evidence_segment_ids.\n"
            "4. Unknown owners, assignees, dates, priorities, and rationale MUST be null.\n"
            "5. Inference is allowed only when inference=true and confidence reflects uncertainty.\n"
            "6. 'confidence' is a number between 0.0 and 1.0: 0.9-1.0 for explicit verbatim commitments, "
            "around 0.6 for strongly implied ones, below 0.4 for weak inferences. "
            "Never leave it at the schema placeholder value.\n\n"
            "Return ONLY a JSON object matching this schema:\n"
            "{\n"
            '  "decisions": [{"decision": "string", "rationale": null, "owner": null, '
            '"evidence_segment_ids": ["seg_000001"], "evidence_quote": "string", '
            '"confidence": 0.9, "inference": false}],\n'
            '  "actions": [{"task": "string", "assignee": null, "due_date": null, '
            '"priority": null, "status": "open", "evidence_segment_ids": ["seg_000001"], '
            '"evidence_quote": "string", "confidence": 0.9, "inference": false}]\n'
            "}\n\n"
            f"{LANGUAGE_RULE}\n"
        )

        evidence_text = self._format_evidence_segments(
            state.get("transcript_segments") or
            self._segments_from_text(state.get("raw_transcript") or state.get("clean_transcript", ""))
        )
        
        messages = [
            SystemMessage(content=prompt),
            HumanMessage(content=evidence_text)
        ]

        data = self._invoke_structured(ClaimExtraction, messages)
        if data is not None:
            decisions, actions = self._validate_evidence_claims(data, state)
            return {"decisions": decisions, "actions": actions}

        response = self.llm.invoke(messages)
        raw = response.content.strip()
        try:
            data = parse_json_payload(raw)
            decisions, actions = self._validate_evidence_claims(data, state)
        except Exception:
            print("DEBUG: [LangGraph] Node 3 JSON parse failed.", file=sys.stderr)
            decisions = []
            actions = []

        return {"decisions": decisions, "actions": actions}

    # --- NODE 3.5: Topic Segmentation (meeting chapters) ---
    def segment_topics_node(self, state: AgentState):
        print("DEBUG: [LangGraph] Node 3.5: Segmenting topics into chapters...", file=sys.stderr)
        segments = state.get("transcript_segments") or []
        if len(segments) < 4:
            return {"chapters": []}

        prompt = self._language_directive() + (
            "Divide the meeting transcript below into 3 to 8 thematic chapters.\n"
            "Rules:\n"
            "1. Each chapter needs: 'title' (max 8 words), 'start_segment_id' (the id in "
            "brackets, e.g. seg_000004, of the FIRST segment of that chapter), and 'summary' "
            "(1-2 sentences).\n"
            "2. start_segment_id MUST be an id that appears in the transcript below. "
            "NEVER invent ids or timestamps.\n"
            "3. The first chapter MUST start at the first segment.\n"
            "4. Chapters must be in chronological order and cover the whole meeting.\n\n"
            "Return ONLY a JSON object matching this schema:\n"
            "{\n"
            '  "chapters": [{"title": "string", "start_segment_id": "seg_000000", '
            '"summary": "string"}]\n'
            "}\n\n"
            f"{LANGUAGE_RULE}\n"
        )

        messages = [
            SystemMessage(content=prompt),
            HumanMessage(content=self._format_evidence_segments(segments)),
        ]

        data = self._invoke_structured(ChapterExtraction, messages)
        if data is None:
            response = self.llm.invoke(messages)
            try:
                data = parse_json_payload(response.content.strip())
            except Exception:
                print("DEBUG: [LangGraph] Node 3.5 JSON parse failed.", file=sys.stderr)
                data = {}
            if not isinstance(data, dict):
                data = {}

        candidates = data.get("chapters", [])
        if not isinstance(candidates, list):
            candidates = []
        return {"chapters": self._finalize_chapters(candidates, segments)}

    @staticmethod
    def _finalize_chapters(candidates: list[dict], segments: list[dict], max_chapters: int = 12) -> list[dict]:
        """
        Validates LLM chapter candidates against the real segment list and derives
        start/end timestamps deterministically — the LLM never supplies timestamps.
        """
        if not segments:
            return []

        index_by_id = {
            segment.get("segment_id", f"seg_{index:06d}"): index
            for index, segment in enumerate(segments)
        }

        valid = []
        seen_ids = set()
        for candidate in candidates:
            if not isinstance(candidate, dict):
                continue
            title = str(candidate.get("title") or "").strip()
            segment_id = str(candidate.get("start_segment_id") or "").strip()
            if not title or segment_id not in index_by_id or segment_id in seen_ids:
                continue
            seen_ids.add(segment_id)
            valid.append({
                "title": title,
                "summary": str(candidate.get("summary") or "").strip(),
                "start_segment_id": segment_id,
            })

        if not valid:
            return []

        valid.sort(key=lambda chapter: index_by_id[chapter["start_segment_id"]])
        valid = valid[:max_chapters]

        # The first chapter always covers the meeting from the very first segment.
        first_id = segments[0].get("segment_id", "seg_000000")
        if index_by_id[valid[0]["start_segment_id"]] != 0:
            valid[0]["start_segment_id"] = first_id

        chapters = []
        for position, chapter in enumerate(valid):
            start_idx = index_by_id[chapter["start_segment_id"]]
            if position + 1 < len(valid):
                end_idx = index_by_id[valid[position + 1]["start_segment_id"]] - 1
            else:
                end_idx = len(segments) - 1
            end_idx = max(start_idx, end_idx)
            chapters.append({
                "title": chapter["title"],
                "summary": chapter["summary"],
                "start_segment_id": chapter["start_segment_id"],
                "start_ms": int(segments[start_idx].get("start_ms") or 0),
                "end_ms": int(segments[end_idx].get("end_ms") or 0),
            })
        return chapters

    @staticmethod
    def _compute_participation(segments: list[dict]) -> list[dict]:
        """
        Deterministic per-speaker stats from diarized segments (no LLM).
        Falls back to word-count percentages when timestamps are absent
        (e.g. segments fabricated by _segments_from_text).
        """
        stats: dict[str, dict] = {}
        for segment in segments:
            speaker_id = segment.get("speaker_id")
            if not speaker_id:
                continue
            entry = stats.setdefault(speaker_id, {
                "speaker_id": speaker_id,
                "speaker_label": segment.get("speaker_name") or speaker_id,
                "turns": 0,
                "talk_time_ms": 0,
                "word_count": 0,
                "percentage": 0.0,
            })
            entry["turns"] += 1
            entry["talk_time_ms"] += max(0, int(segment.get("end_ms") or 0) - int(segment.get("start_ms") or 0))
            entry["word_count"] += len(str(segment.get("text") or "").split())

        if not stats:
            return []

        total_time = sum(entry["talk_time_ms"] for entry in stats.values())
        basis = "talk_time_ms" if total_time > 0 else "word_count"
        total = sum(entry[basis] for entry in stats.values())
        for entry in stats.values():
            entry["percentage"] = round(100.0 * entry[basis] / total, 1) if total > 0 else 0.0

        return sorted(stats.values(), key=lambda entry: entry["percentage"], reverse=True)

    @staticmethod
    def _segments_from_text(text: str) -> list[dict]:
        segments = []
        for index, line in enumerate(line for line in text.splitlines() if line.strip()):
            segments.append({
                "segment_id": f"seg_{index:06d}",
                "speaker_id": None,
                "speaker_name": None,
                "start_ms": 0,
                "end_ms": 0,
                "text": line.strip(),
                "confidence": None,
                "words": [],
            })
        if not segments and text.strip():
            segments.append({
                "segment_id": "seg_000000",
                "speaker_id": None,
                "speaker_name": None,
                "start_ms": 0,
                "end_ms": 0,
                "text": text.strip(),
                "confidence": None,
                "words": [],
            })
        return segments

    @staticmethod
    def _format_evidence_segments(segments: list[dict]) -> str:
        return "\n".join(
            f"[{segment.get('segment_id', f'seg_{index:06d}')}] "
            f"{segment.get('speaker_name') or segment.get('speaker_id') or 'Unknown speaker'}: "
            f"{segment.get('text', '')}"
            for index, segment in enumerate(segments)
        )

    @staticmethod
    def _chunk_transcript_segments(
        segments: list[dict],
        max_chars: int,
        overlap_segments: int = 1,
    ) -> list[list[dict]]:
        """Split at segment boundaries while retaining small context overlap."""
        if not segments:
            return []

        chunks = []
        current = []
        current_chars = 0

        for segment in segments:
            segment_chars = len(segment.get("text", "")) + 1
            if current and current_chars + segment_chars > max_chars:
                chunks.append(current)
                overlap = current[-overlap_segments:] if overlap_segments > 0 else []
                current = list(overlap)
                current_chars = sum(len(item.get("text", "")) + 1 for item in current)

            current.append(segment)
            current_chars += segment_chars

        if current and (not chunks or current != chunks[-1]):
            chunks.append(current)
        return chunks

    @staticmethod
    def _deduplicate_claims(claims: list[dict], text_key: str) -> list[dict]:
        unique = []
        seen = set()
        for claim in claims:
            evidence_ids = tuple(claim.get("evidence_segment_ids", []))
            key = (
                " ".join(str(claim.get(text_key, "")).lower().split()),
                evidence_ids,
            )
            if key in seen:
                continue
            seen.add(key)
            unique.append(claim)
        return unique

    def _validate_evidence_claims(self, data: dict, state: AgentState) -> tuple[list, list]:
        segments = state.get("transcript_segments") or self._segments_from_text(
            state.get("raw_transcript") or state.get("clean_transcript", "")
        )
        segment_map = {
            segment.get("segment_id", f"seg_{index:06d}"): segment
            for index, segment in enumerate(segments)
        }

        decisions = []
        for candidate in data.get("decisions", []):
            resolved = self._resolve_claim_evidence(candidate, segment_map)
            if resolved is None:
                continue
            quote, evidence_ids, confidence, inference = resolved
            try:
                decision = Decision(
                    decision=candidate.get("decision") or candidate.get("text") or "",
                    rationale=candidate.get("rationale"),
                    owner=candidate.get("owner"),
                    evidence_segment_ids=evidence_ids,
                    evidence_quote=quote,
                    confidence=confidence,
                    inference=inference,
                ).model_dump()
                decision["text"] = decision["decision"]
                decision["source_quote"] = quote
                decisions.append(decision)
            except Exception as error:
                print(f"DEBUG: [Decision Validation] Rejected claim: {error}", file=sys.stderr)

        actions = []
        for candidate in data.get("actions", data.get("action_items", [])):
            resolved = self._resolve_claim_evidence(candidate, segment_map)
            if resolved is None:
                continue
            quote, evidence_ids, confidence, inference = resolved
            try:
                action = ActionItem(
                    task=candidate.get("task") or candidate.get("what") or "",
                    assignee=candidate.get("assignee", candidate.get("who")),
                    due_date=candidate.get("due_date", candidate.get("due")),
                    priority=self._normalize_priority(candidate.get("priority")),
                    status=self._normalize_status(candidate.get("status")),
                    evidence_segment_ids=evidence_ids,
                    evidence_quote=quote,
                    confidence=confidence,
                    inference=inference,
                ).model_dump()
                action["what"] = action["task"]
                action["who"] = action["assignee"]
                action["due"] = action["due_date"]
                action["source_quote"] = quote
                actions.append(action)
            except Exception as error:
                print(f"DEBUG: [Action Validation] Rejected claim: {error}", file=sys.stderr)

        return decisions, actions

    def _resolve_claim_evidence(
        self, candidate: dict, segment_map: dict
    ) -> tuple[str, list[str], float, bool] | None:
        """
        Matches a claim's evidence quote against the transcript. Exact matches keep the
        claim as-is; near matches (paraphrased quotes) are downgraded to inference with a
        confidence penalty and the quote is replaced by the actual transcript text, so the
        UI always shows real evidence. Returns None when no segment supports the claim.
        """
        quote = candidate.get("evidence_quote") or candidate.get("source_quote")
        if not quote:
            return None

        evidence_ids, match_score, matched_text = self._resolve_evidence(
            quote, candidate.get("evidence_segment_ids", []), segment_map
        )
        if not evidence_ids:
            return None

        confidence = self._claim_confidence(candidate)
        inference = bool(candidate.get("inference", False))
        if match_score < 1.0:
            confidence = min(confidence, max(0.0, round(match_score - 0.1, 2)))
            inference = True
            quote = matched_text
        return quote, evidence_ids, confidence, inference

    @staticmethod
    def _normalize_priority(priority) -> str | None:
        if isinstance(priority, str):
            normalized = priority.strip().capitalize()
            if normalized in {"High", "Medium", "Low"}:
                return normalized
        return None

    @staticmethod
    def _normalize_status(status) -> str:
        if isinstance(status, str):
            normalized = status.strip().lower()
            if normalized in {"open", "completed", "cancelled"}:
                return normalized
        return "open"

    @staticmethod
    def _normalize_evidence_text(text: str) -> str:
        return " ".join(text.lower().split())

    def _resolve_evidence(
        self, quote: str, requested_ids: list, segment_map: dict
    ) -> tuple[list[str], float, str]:
        """
        Finds the transcript segments supporting a quote.
        Returns (segment_ids, match_score, matched_text): score 1.0 for exact
        (normalized substring) matches, otherwise the best fuzzy score against a
        single segment when it clears FUZZY_EVIDENCE_THRESHOLD, else ([], score, quote).
        """
        normalized_quote = self._normalize_evidence_text(quote)
        valid_requested = [
            segment_id for segment_id in requested_ids
            if segment_id in segment_map
            and normalized_quote in self._normalize_evidence_text(segment_map[segment_id].get("text", ""))
        ]
        if valid_requested:
            return valid_requested, 1.0, quote

        exact_ids = [
            segment_id for segment_id, segment in segment_map.items()
            if normalized_quote in self._normalize_evidence_text(segment.get("text", ""))
        ]
        if exact_ids:
            return exact_ids, 1.0, quote

        # Fuzzy fallback: local models often paraphrase quotes slightly. Prefer the
        # segments the model itself pointed at when scores tie.
        best_id = None
        best_score = 0.0
        for segment_id, segment in segment_map.items():
            score = self._fuzzy_match_score(quote, segment.get("text", ""))
            if score > best_score or (score == best_score and segment_id in requested_ids):
                best_id, best_score = segment_id, score

        if best_id is not None and best_score >= FUZZY_EVIDENCE_THRESHOLD:
            matched_text = (segment_map[best_id].get("text") or "").strip()
            return [best_id], best_score, matched_text
        return [], best_score, quote

    @staticmethod
    def _normalize_for_fuzzy(text: str) -> str:
        text = re.sub(r"[^\w\s]", " ", text.lower())
        return " ".join(text.split())

    @classmethod
    def _fuzzy_match_score(cls, quote: str, segment_text: str) -> float:
        """
        Similarity (0..1) of a quote against the best same-length word window of a
        segment. Uses min(char ratio, token ratio): the token ratio punishes word
        substitutions ('delete' vs 'keep') that char-level similarity glosses over,
        so meaning inversions stay below the acceptance threshold.
        """
        needle = cls._normalize_for_fuzzy(quote)
        haystack = cls._normalize_for_fuzzy(segment_text)
        if not needle or not haystack:
            return 0.0
        if needle in haystack:
            return 1.0

        needle_words = needle.split()
        haystack_words = haystack.split()
        window = len(needle_words)
        if window >= len(haystack_words):
            char_ratio = SequenceMatcher(None, needle, haystack).ratio()
            token_ratio = SequenceMatcher(None, needle_words, haystack_words).ratio()
            return min(char_ratio, token_ratio)

        best = 0.0
        for start in range(len(haystack_words) - window + 1):
            window_words = haystack_words[start:start + window]
            window_text = " ".join(window_words)
            char_ratio = SequenceMatcher(None, needle, window_text).ratio()
            token_ratio = SequenceMatcher(None, needle_words, window_words).ratio()
            score = min(char_ratio, token_ratio)
            if score > best:
                best = score
                if best == 1.0:
                    break
        return best

    @staticmethod
    def _claim_confidence(candidate: dict) -> float:
        # A missing/invalid confidence must not masquerade as high confidence
        try:
            return max(0.0, min(1.0, float(candidate.get("confidence", 0.5))))
        except (TypeError, ValueError):
            return 0.5

    @staticmethod
    def _fallback_summary_from_state(state: AgentState, decisions: list, actions: list) -> dict:
        transcript = (
            state.get("clean_transcript")
            or state.get("raw_transcript")
            or ""
        ).strip()
        sentences = [
            sentence.strip()
            for sentence in re.split(r"(?<=[.!?])\s+", transcript)
            if sentence.strip()
        ]
        tldr = sentences[0] if sentences else "Summary could not be generated from the available transcript."
        if len(tldr) > 240:
            tldr = tldr[:237].rstrip() + "..."

        summary_points = sentences[:3] if sentences else []
        entities = state.get("entities", {}) or {}
        tags = [
            str(tag)
            for tag in entities.get("projects", [])[:5]
            if str(tag).strip()
        ]
        participants = [
            {
                "name": speaker.get("name", "Unknown"),
                "role": speaker.get("role_hint") or "",
                "engagement_level": "unknown",
            }
            for speaker in entities.get("speakers", [])[:10]
            if isinstance(speaker, dict)
        ]
        metrics = [
            {
                "label": number.get("context", "Metric"),
                "value": number.get("value", ""),
                "trend": "flat",
            }
            for number in entities.get("numbers", [])[:10]
            if isinstance(number, dict)
        ]

        return {
            "metadata": {"title": "Meeting Summary", "date": state.get("meeting_date", ""), "tags": tags},
            "tldr": tldr,
            "participants": participants,
            "metrics": metrics,
            "key_decisions": [],
            "action_items": [],
            "summary_points": summary_points,
            "summary_generation_warning": "LLM returned invalid structured JSON; generated fallback summary from transcript.",
        }

    def _parse_summary_or_repair(self, raw: str) -> dict:
        try:
            structured = parse_json_payload(raw)
            if isinstance(structured, dict):
                return structured
            raise ValueError("Structured summary payload was not a JSON object.")
        except Exception as parse_error:
            print(f"DEBUG: [LangGraph] Node 4 JSON parse failed: {parse_error}", file=sys.stderr)

        repair_prompt = (
            "Convert the following malformed meeting-summary response into ONE valid JSON object.\n"
            "Return ONLY JSON. Do not include markdown fences, prose, comments, or trailing commas.\n"
            "The JSON object must include these keys: metadata, tldr, participants, metrics, "
            "summary_points, risks, open_questions, unresolved_topics.\n"
            "Use empty arrays for missing list fields and empty strings for missing scalar fields.\n"
            "Keep all text values in their original language. Do NOT translate them."
        )
        repair_response = self.llm.invoke([
            SystemMessage(content=repair_prompt),
            HumanMessage(content=raw[:12000]),
        ])
        repaired = parse_json_payload(repair_response.content.strip())
        if not isinstance(repaired, dict):
            raise ValueError("Repaired structured summary payload was not a JSON object.")
        repaired["summary_generation_warning"] = "LLM summary JSON was repaired before rendering."
        return repaired

    # --- NODE 4: Structured Summary (JSON) ---
    def generate_summary_node(self, state: AgentState):
        print("DEBUG: [LangGraph] Node 4: Generating structured summary...", file=sys.stderr)

        entities = state.get("entities", {})
        decisions = state.get("decisions", [])
        actions = state.get("actions", [])
        numbers = entities.get("numbers", [])
        speakers = entities.get("speakers", [])

        base_prompt = self._language_directive() + (
            "You are an expert AI meeting analyst and executive assistant. Your task is to process the following meeting transcript and extract the key information into a highly structured JSON object.\n\n"
            "Follow these strict extraction rules:\n"
            "1. 'metadata.title': Create a short, descriptive title (max 5 words).\n"
            "2. 'tldr': Write exactly ONE sentence capturing the ultimate outcome or bottom line.\n"
            "3. 'metrics': Extract any quantifiable data, numbers, or KPIs mentioned. If none, return an empty array [].\n"
            "4. Do not restate decisions and action items. They are supplied separately as verified claims and merged in later.\n"
            "5. 'risks': Concrete risks, blockers, or concerns explicitly raised in the meeting. If none, return [].\n"
            "6. 'open_questions': Questions that were raised but left unanswered. If none, return [].\n"
            "7. 'unresolved_topics': Topics that were discussed but ended without a conclusion or decision. If none, return [].\n"
            "8. For rules 5-7, only report what was actually said. Do NOT invent risks or questions.\n"
            "9. 'summary_points': 3 to 6 bullet points, each covering a DISTINCT topic discussed, "
            "ordered by importance. Do not repeat the tldr. Use fewer points for short meetings.\n\n"
            "You MUST output ONLY valid JSON matching the exact schema below. Do not include markdown code blocks, prefaces, or explanations.\n\n"
            "OUTPUT SCHEMA:\n"
            "{\n"
            '  "metadata": {"title": "string", "date": "string", "tags": ["string"]},\n'
            '  "tldr": "string",\n'
            '  "participants": [{"name": "string", "role": "string", "engagement_level": "string"}],\n'
            '  "metrics": [{"label": "string", "value": "string", "trend": "string"}],\n'
            '  "summary_points": ["string"],\n'
            '  "risks": ["string"],\n'
            '  "open_questions": ["string"],\n'
            '  "unresolved_topics": ["string"]\n'
            "}\n\n"
            f"{LANGUAGE_RULE}\n"
        )

        if self.system_prompt:
            prompt = f"{self.system_prompt}\n\n{base_prompt}"
        else:
            prompt = base_prompt

        content_block = (
            f"CLEAN TRANSCRIPT:\n{state.get('clean_transcript', '')}\n\n"
            f"DECISIONS:\n{json_lib.dumps(decisions)}\n\n"
            f"ACTIONS:\n{json_lib.dumps(actions)}\n\n"
            f"NUMBERS:\n{json_lib.dumps(numbers)}\n\n"
            f"SPEAKERS:\n{json_lib.dumps(speakers)}\n"
        )

        messages = [
            SystemMessage(content=prompt),
            HumanMessage(content=content_block)
        ]

        structured = self._invoke_structured(StructuredMeetingSummary, messages)
        if structured is None:
            response = self.llm.invoke(messages)
            raw = response.content.strip()
            try:
                structured = self._parse_summary_or_repair(raw)
            except Exception:
                print("DEBUG: [LangGraph] Node 4 JSON repair failed.", file=sys.stderr)
                structured = self._fallback_summary_from_state(state, decisions, actions)

        structured["schema_version"] = SCHEMA_VERSION
        structured["key_decisions"] = [
            {
                key: value for key, value in decision.items()
                if key not in {"text", "source_quote"}
            }
            for decision in decisions
        ]
        structured["action_items"] = [
            {
                key: value for key, value in action.items()
                if key not in {"what", "who", "due", "source_quote"}
            }
            for action in actions
        ]
        structured.setdefault("risks", [])
        structured.setdefault("open_questions", [])
        structured.setdefault("unresolved_topics", [])
        structured["chapters"] = state.get("chapters", [])
        structured["participation"] = self._compute_participation(
            state.get("transcript_segments") or []
        )
        # Deterministic: language comes from transcription, never from the LLM.
        metadata = structured.setdefault("metadata", {})
        if isinstance(metadata, dict):
            metadata["language"] = self.language or ""

        return {
            "final_markdown": "",
            "structured_summary": structured,
        }

    def generate_followup_email(self, structured: dict) -> dict:
        """
        Drafts a follow-up email from the structured summary JSON (never from the
        raw transcript, so it cannot introduce facts the summary does not contain).
        On-demand: invoked via the GENERATE_FOLLOWUP action, not part of run().
        """
        metadata = structured.get("metadata") or {}
        source = {
            "title": metadata.get("title", ""),
            "date": metadata.get("date", ""),
            "tldr": structured.get("tldr", ""),
            "participants": structured.get("participants", []),
            "key_decisions": structured.get("key_decisions", []),
            "action_items": structured.get("action_items", []),
            "risks": structured.get("risks", []),
            "open_questions": structured.get("open_questions", []),
            "unresolved_topics": structured.get("unresolved_topics", []),
        }

        prompt = self._language_directive() + (
            "Write a concise, professional follow-up email for the meeting summarized "
            "in the JSON below.\n"
            "Rules:\n"
            "1. Structure: one short context paragraph (from the tldr), then decisions, "
            "then action items with assignee and due date when present, then open "
            "questions/risks if any.\n"
            "2. Use ONLY facts present in the JSON. Do NOT invent names, dates, or "
            "placeholders like [Name].\n"
            "3. Plain text body, no markdown headers. Keep it under ~250 words.\n\n"
            "Return ONLY a JSON object matching this schema:\n"
            "{\n"
            '  "subject": "string",\n'
            '  "body": "string"\n'
            "}\n\n"
            f"{LANGUAGE_RULE}\n"
        )

        messages = [
            SystemMessage(content=prompt),
            HumanMessage(content=json_lib.dumps(source, ensure_ascii=False)),
        ]

        data = self._invoke_structured(FollowUpEmail, messages)
        if data is None:
            response = self.llm.invoke(messages)
            raw = response.content.strip()
            try:
                data = parse_json_payload(raw)
            except Exception:
                print("DEBUG: [Follow-up] JSON parse failed; using raw text as body.", file=sys.stderr)
                data = {}
            if not isinstance(data, dict):
                data = {}
            if not data.get("body"):
                data = {"body": raw}

        subject = str(data.get("subject") or "").strip()
        if not subject:
            title = metadata.get("title") or "Meeting"
            subject = f"Follow-up: {title}"
        return {"subject": subject, "body": str(data.get("body") or "").strip()}

    @staticmethod
    def _compact_for_continuity(structured: dict) -> dict:
        """Trims a structured summary to the fields (and sizes) the continuity
        prompt needs, tolerating summaries from older schema versions."""
        structured = structured if isinstance(structured, dict) else {}
        metadata = structured.get("metadata") or {}
        if not isinstance(metadata, dict):
            metadata = {}

        decisions = []
        for decision in (structured.get("key_decisions") or [])[:10]:
            if isinstance(decision, dict) and decision.get("decision"):
                decisions.append({
                    "decision": str(decision.get("decision")),
                    "owner": decision.get("owner"),
                })

        actions = []
        for action in (structured.get("action_items") or [])[:15]:
            if isinstance(action, dict) and action.get("task"):
                actions.append({
                    "task": str(action.get("task")),
                    "assignee": action.get("assignee"),
                    "status": action.get("status") or "open",
                    "due_date": action.get("due_date"),
                })

        def _texts(items, limit):
            return [str(item) for item in (items or [])[:limit] if str(item).strip()]

        return {
            "title": str(metadata.get("title") or ""),
            "date": str(metadata.get("date") or ""),
            "tldr": str(structured.get("tldr") or "")[:400],
            "tags": _texts(metadata.get("tags"), 8),
            "key_decisions": decisions,
            "action_items": actions,
            "open_questions": _texts(structured.get("open_questions"), 8),
            "unresolved_topics": _texts(structured.get("unresolved_topics"), 8),
        }

    def generate_continuity_report(self, current: dict, related: list) -> dict:
        """
        Cross-meeting diff: what changed since the related previous meetings.
        related items: {meeting_id, title, date, via ('rag'|'recency'),
        summary: <structured dict>}. related_meetings in the output is built
        deterministically from this list, never by the LLM; meeting ids the LLM
        cites inside items are sanitized against the allowed set.
        """
        related = [
            meeting for meeting in related or []
            if isinstance(meeting, dict) and meeting.get("meeting_id") is not None
        ]
        related_meetings = [
            {
                "meeting_id": meeting["meeting_id"],
                "title": str(meeting.get("title") or ""),
                "date": str(meeting.get("date") or ""),
                "reason": "similar content" if meeting.get("via") == "rag" else "recent meeting",
            }
            for meeting in related
        ]
        allowed_ids = {meeting["meeting_id"] for meeting in related}

        compact_related = [
            {
                "meeting_id": meeting["meeting_id"],
                "title": str(meeting.get("title") or ""),
                "date": str(meeting.get("date") or ""),
                "summary": self._compact_for_continuity(meeting.get("summary") or {}),
            }
            for meeting in related
        ]
        hint_actions = find_recurring_open_actions(
            (current or {}).get("action_items") or [],
            compact_related,
        )
        hint_topics = find_recurring_topics(current or {}, compact_related)
        hints = {"recurring_open_actions": hint_actions, "recurring_topics": hint_topics}

        allowed_ids_text = ", ".join(str(meeting_id) for meeting_id in sorted(allowed_ids)) or "none"
        prompt = self._language_directive() + (
            "Compare the CURRENT meeting against the PREVIOUS meetings JSON and report "
            "cross-meeting continuity.\n"
            "Rules:\n"
            "1. Report ONLY: decisions that were reverted or materially changed since a "
            "previous meeting; open action items that recur across meetings without being "
            "completed; topics that keep reappearing.\n"
            f"2. Use ONLY facts present in the JSON. Do NOT invent meetings, decisions, "
            f"tasks, dates or ids. previous_meeting_id and first_seen_meeting_id MUST be "
            f"one of these ids: [{allowed_ids_text}] or null.\n"
            "3. The DETERMINISTIC HINTS below were computed by exact text matching — "
            "include them (you may refine the wording) and add only what the JSON supports.\n"
            "4. If nothing changed, return empty lists and a one-sentence summary saying "
            "the meetings are consistent.\n\n"
            "Return ONLY a JSON object matching this schema:\n"
            "{\n"
            '  "reverted_or_changed_decisions": [{"current": "string", "previous": "string", '
            '"previous_meeting_id": 1, "note": "string"}],\n'
            '  "recurring_open_actions": [{"task": "string", "first_seen_meeting_id": 1, '
            '"occurrences": 2, "note": "string"}],\n'
            '  "recurring_topics": ["string"],\n'
            '  "summary": "string"\n'
            "}\n\n"
            f"{LANGUAGE_RULE}\n"
        )
        human = (
            f"CURRENT MEETING:\n{json_lib.dumps(self._compact_for_continuity(current or {}), ensure_ascii=False)}\n\n"
            f"PREVIOUS MEETINGS:\n{json_lib.dumps(compact_related, ensure_ascii=False)}\n\n"
            f"DETERMINISTIC HINTS:\n{json_lib.dumps(hints, ensure_ascii=False)}"
        )
        messages = [SystemMessage(content=prompt), HumanMessage(content=human)]

        data = self._invoke_structured(ContinuityAnalysis, messages)
        if data is None:
            response = self.llm.invoke(messages)
            try:
                data = parse_json_payload(response.content.strip())
            except Exception:
                print("DEBUG: [Continuity] JSON parse failed; using deterministic hints only.", file=sys.stderr)
                data = None
            if not isinstance(data, dict):
                data = None
        if data is None:
            # Never fail on parsing: fall back to the deterministic pre-pass.
            data = {
                "reverted_or_changed_decisions": [],
                "recurring_open_actions": [
                    {
                        "task": hint["task"],
                        "first_seen_meeting_id": hint["first_seen_meeting_id"],
                        "occurrences": hint["occurrences"],
                        "note": "Detected by deterministic text matching.",
                    }
                    for hint in hint_actions
                ],
                "recurring_topics": hint_topics,
                "summary": "",
            }

        def _sanitize_id(value):
            return value if value in allowed_ids else None

        changed = []
        for item in (data.get("reverted_or_changed_decisions") or [])[:10]:
            if isinstance(item, dict) and item.get("current"):
                changed.append({
                    "current": str(item.get("current")),
                    "previous": str(item.get("previous") or ""),
                    "previous_meeting_id": _sanitize_id(item.get("previous_meeting_id")),
                    "note": str(item.get("note") or ""),
                })
        recurring_actions = []
        for item in (data.get("recurring_open_actions") or [])[:10]:
            if isinstance(item, dict) and item.get("task"):
                try:
                    occurrences = max(1, int(item.get("occurrences") or 1))
                except (TypeError, ValueError):
                    occurrences = 1
                recurring_actions.append({
                    "task": str(item.get("task")),
                    "first_seen_meeting_id": _sanitize_id(item.get("first_seen_meeting_id")),
                    "occurrences": occurrences,
                    "note": str(item.get("note") or ""),
                })
        recurring_topics = [
            str(topic) for topic in (data.get("recurring_topics") or [])[:10] if str(topic).strip()
        ]

        return {
            "related_meetings": related_meetings,
            "reverted_or_changed_decisions": changed,
            "recurring_open_actions": recurring_actions,
            "recurring_topics": recurring_topics,
            "summary": str(data.get("summary") or "").strip(),
        }

    def run(
        self,
        transcript: str,
        diarized_segments: list = None,
        meeting_date: str = None,
        transcript_segments: list = None,
        progress_callback=None,
    ) -> dict:
        """Builds the graph, compiles it, and runs the transcript through the nodes."""

        def emit_progress(update: dict):
            if not progress_callback:
                return
            try:
                progress_callback(update)
            except Exception as error:
                print(f"DEBUG: [LangGraph] Progress callback failed: {error}", file=sys.stderr)
        
        # Token estimation & Map-Reduce check
        char_count = len(transcript)
        tokens_per_char = DEFAULTS["tokens_per_char"]
        est_tokens = char_count / tokens_per_char
        threshold = DEFAULTS["num_ctx"] * 0.6
        
        print(f"DEBUG: [LangGraph] Estimated tokens: {est_tokens:.1f} (Threshold: {threshold})", file=sys.stderr)
        
        if est_tokens > threshold:
            print("DEBUG: [LangGraph] Long meeting detected. Applying map-reduce chunking...", file=sys.stderr)
            source_segments = transcript_segments or self._segments_from_text(transcript)
            max_chunk_chars = max(1, int(threshold * tokens_per_char))
            segment_chunks = self._chunk_transcript_segments(
                source_segments,
                max_chars=max_chunk_chars,
            )
            emit_progress({
                "stage": "calling_ai",
                "message": "Calling AI with chunked context...",
                "progress": 0.25,
                "chunk_total": len(segment_chunks),
            })
            
            merged_entities = {"speakers": [], "numbers": [], "dates": [], "projects": [], "acronyms": []}
            merged_decisions = []
            merged_actions = []
            merged_chapters = []
            merged_clean = ""
            
            for i, chunk_segments in enumerate(segment_chunks):
                print(f"DEBUG: [LangGraph] Processing chunk {i+1}/{len(segment_chunks)}", file=sys.stderr)
                emit_progress({
                    "stage": "processing_chunk",
                    "message": f"Processing chunk {i + 1}/{len(segment_chunks)}...",
                    "progress": 0.25 + ((i + 1) / max(1, len(segment_chunks))) * 0.55,
                    "chunk_current": i + 1,
                    "chunk_total": len(segment_chunks),
                })
                chunk = "\n".join(segment.get("text", "") for segment in chunk_segments)
                chunk_state = {
                    "raw_transcript": chunk,
                    "diarized_segments": diarized_segments,
                    "transcript_segments": chunk_segments,
                    "meeting_date": meeting_date or "",
                }
                res_e = self.extract_entities_node(chunk_state)
                # merge entities
                for k in merged_entities:
                    merged_entities[k].extend(res_e["entities"].get(k, []))
                
                chunk_state["entities"] = res_e["entities"]
                res_c = self.clean_transcript_node(chunk_state)
                merged_clean += res_c.get("clean_transcript", "") + "\n\n"
                
                chunk_state["clean_transcript"] = res_c.get("clean_transcript", "")
                res_a = self.extract_action_items_node(chunk_state)
                merged_decisions.extend(res_a.get("decisions", []))
                merged_actions.extend(res_a.get("actions", []))

                res_t = self.segment_topics_node(chunk_state)
                merged_chapters.extend(res_t.get("chapters", []))

            merged_decisions = self._deduplicate_claims(merged_decisions, "decision")
            merged_actions = self._deduplicate_claims(merged_actions, "task")

            # Chunks overlap by one segment, so chapters can repeat at boundaries;
            # re-finalizing against the full segment list dedupes and recomputes
            # end timestamps across chunk borders.
            merged_chapters = self._finalize_chapters(merged_chapters, source_segments)

            emit_progress({
                "stage": "finalizing",
                "message": "Finalizing summary...",
                "progress": 0.9,
                "chunk_total": len(segment_chunks),
            })
            final_state = {
                "entities": merged_entities,
                "clean_transcript": merged_clean.strip(),
                "decisions": merged_decisions,
                "actions": merged_actions,
                "chapters": merged_chapters,
                "transcript_segments": source_segments,
            }
            res_s = self.generate_summary_node(final_state)
            return {
                "markdown": res_s.get("final_markdown", ""),
                "structured": res_s.get("structured_summary", {}),
            }
        else:
            print("DEBUG: [LangGraph] Building and compiling workflow graph...", file=sys.stderr)
            
            # NOTE: any node added here must also be invoked manually in the
            # long-meeting map-reduce branch above — the two paths are duplicated.
            workflow = StateGraph(AgentState)
            workflow.add_node("extraction_entities", self.extract_entities_node)
            workflow.add_node("cleanup", self.clean_transcript_node)
            workflow.add_node("extraction_actions", self.extract_action_items_node)
            workflow.add_node("topic_segmentation", self.segment_topics_node)
            workflow.add_node("summary", self.generate_summary_node)

            workflow.add_edge(START, "extraction_entities")
            workflow.add_edge("extraction_entities", "cleanup")
            workflow.add_edge("cleanup", "extraction_actions")
            workflow.add_edge("extraction_actions", "topic_segmentation")
            workflow.add_edge("topic_segmentation", "summary")
            workflow.add_edge("summary", END)
            
            app = workflow.compile()
            try:
                print("DEBUG: [LangGraph] Executing workflow...", file=sys.stderr)
                emit_progress({
                    "stage": "calling_ai",
                    "message": "Calling AI model...",
                    "progress": 0.35,
                })
                result = app.invoke({
                    "raw_transcript": transcript,
                    "diarized_segments": diarized_segments,
                    "transcript_segments": transcript_segments or self._segments_from_text(transcript),
                    "meeting_date": meeting_date or "",
                })
                emit_progress({
                    "stage": "finalizing",
                    "message": "Finalizing summary...",
                    "progress": 0.9,
                })
                return {
                    "markdown": result.get("final_markdown", ""),
                    "structured": result.get("structured_summary", {}),
                }
            except Exception as e:
                raise RuntimeError(f"Workflow execution failed: {str(e)}")

# ---------------------------------------------------------
# STRATEGY PATTERN ADAPTER
# ---------------------------------------------------------
class LangGraphStrategy:
    """Adapter to plug the LangGraph engine into our existing LLMFactory."""
    def __init__(self, provider_name: str, model_name: str):
        self.provider_name = provider_name
        self.model_name = model_name

    def generate_notes(
        self,
        transcription: str,
        api_key: str = None,
        system_prompt: str = None,
        diarized_segments: list = None,
        meeting_date: str = None,
        transcript_segments: list = None,
        language: str = None,
        progress_callback=None,
    ) -> dict:
        try:
            engine = MeetingWorkflowEngine(
                self.provider_name, self.model_name,
                api_key=api_key, system_prompt=system_prompt,
                language=language,
            )
            return engine.run(
                transcription,
                diarized_segments=diarized_segments,
                meeting_date=meeting_date,
                transcript_segments=transcript_segments,
                progress_callback=progress_callback,
            )
        except Exception as e:
            return {"markdown": f"[LangGraph Error: {str(e)}]", "structured": {}}

class LLMFactory:
    @staticmethod
    def get_provider(provider_name: str, model_config: str = None) -> LangGraphStrategy:
        """
        Returns the LangGraph Strategy configured for the chosen provider.
        """
        provider_name = provider_name.lower()
        manifest_defaults = load_model_manifest().get("llm_defaults", {})
        
        # Set default models if none provided by the frontend
        if provider_name == "ollama" and not model_config:
            model_config = manifest_defaults.get("ollama", DEFAULTS["model"])
        elif provider_name == "openai" and not model_config:
            model_config = manifest_defaults.get("openai", "gpt-4o")
        elif provider_name == "gemini" and not model_config:
            model_config = manifest_defaults.get("gemini", "gemini-2.5-flash")
        elif provider_name == "anthropic" and not model_config:
            model_config = manifest_defaults.get("anthropic", "claude-3-haiku-20240307")
            
        return LangGraphStrategy(provider_name, model_config)
