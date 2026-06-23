# src-python/llm_service.py
import sys
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from langchain_core.messages import SystemMessage, HumanMessage
import json as json_lib
import re
from config import DEFAULTS, load_model_manifest
from schemas import ActionItem, Decision, SCHEMA_VERSION


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
    def __init__(self, provider_name: str, model_name: str, api_key: str = None, system_prompt: str = None):
        self.provider_name = provider_name.lower()
        self.model_name = model_name
        self.api_key = api_key
        # Custom system prompt injected as prefix on the final summary node
        self.system_prompt = system_prompt.strip() if system_prompt else None
        self.llm = self._initialize_llm()

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

    # --- NODE 1: Entity Extraction ---
    def extract_entities_node(self, state: AgentState):
        print("DEBUG: [LangGraph] Node 1: Extracting entities...", file=sys.stderr)
        prompt = (
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
            "}\n"
        )
        
        # If diarized segments exist, provide them as helpful context
        text_to_analyze = state["raw_transcript"]
        if state.get("diarized_segments"):
            text_to_analyze += "\n\nDIARIZATION HINTS (Speaker labels and text):\n"
            for seg in state["diarized_segments"][:20]: # just a hint from the start
                text_to_analyze += f"{seg['speaker']}: {seg['text']}\n"

        response = self.llm.invoke([
            SystemMessage(content=prompt),
            HumanMessage(content=text_to_analyze)
        ])
        
        raw = response.content.strip()
        try:
            entities = parse_json_payload(raw)
            # Ensure safe fallback keys
            for k in ["speakers", "numbers", "dates", "projects", "acronyms"]:
                if k not in entities:
                    entities[k] = []
        except Exception:
            print("DEBUG: [LangGraph] Node 1 JSON parse failed.", file=sys.stderr)
            entities = {"speakers": [], "numbers": [], "dates": [], "projects": [], "acronyms": []}

        return {"entities": entities}

    # --- NODE 2: Speaker-Aware Transcript Cleanup ---
    def clean_transcript_node(self, state: AgentState):
        print("DEBUG: [LangGraph] Node 2: Cleaning transcript...", file=sys.stderr)
        
        base_text = state["raw_transcript"]
        diarized = state.get("diarized_segments")
        entities = state.get("entities", {})
        
        if diarized:
            # We have speaker labels, let's see if we can resolve them
            prompt = (
                "You are an editor. Reformat the diarized meeting transcript below into a readable script format.\n"
                "Fix grammar and remove conversational fillers ('uh', 'um', 'like').\n"
                "CRITICAL INSTRUCTIONS:\n"
                "1. If a speaker introduces themselves or is addressed by name, use their real name from the Entities list "
                "instead of their SPEAKER_XX label.\n"
                "2. Preserve turn-taking formatting: '**SpeakerName:** utterance'.\n"
                "3. Keep the original meaning perfectly intact. NEVER reframe negations (e.g., 'we won't ship' MUST remain negative).\n"
                "4. Return ONLY the cleaned formatted script.\n\n"
                f"ENTITIES LIST (Real Names): {json_lib.dumps(entities.get('speakers', []))}\n"
            )
            
            diarized_text = "\n".join(f"{seg['speaker']}: {seg['text']}" for seg in diarized)
            content_to_clean = diarized_text
        else:
            prompt = (
                "You are an editor. Fix grammar, typos, and remove filler words (e.g., 'uh', 'um', 'like') "
                "from the following meeting transcript. Keep the original meaning intact.\n"
                "NEVER reframe negations (e.g., 'we won't ship' MUST remain negative).\n"
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
        prompt = (
            "Analyze the evidence transcript and extract ONLY decisions made and action items.\n"
            "Rules:\n"
            "1. Decisions are concrete choices made (e.g., 'we will go with Postgres').\n"
            "2. Action items are explicit commitments or requests. Do not convert suggestions into tasks.\n"
            "3. Every decision and action MUST include an exact evidence_quote copied from the transcript and evidence_segment_ids.\n"
            "4. Unknown owners, assignees, dates, priorities, and rationale MUST be null.\n"
            "5. Inference is allowed only when inference=true and confidence reflects uncertainty.\n\n"
            "Return ONLY a JSON object matching this schema:\n"
            "{\n"
            '  "decisions": [{"decision": "string", "rationale": null, "owner": null, '
            '"evidence_segment_ids": ["seg_000001"], "evidence_quote": "string", '
            '"confidence": 0.0, "inference": false}],\n'
            '  "actions": [{"task": "string", "assignee": null, "due_date": null, '
            '"priority": null, "status": "open", "evidence_segment_ids": ["seg_000001"], '
            '"evidence_quote": "string", "confidence": 0.0, "inference": false}]\n'
            "}\n"
        )

        evidence_text = self._format_evidence_segments(
            state.get("transcript_segments") or
            self._segments_from_text(state.get("raw_transcript") or state.get("clean_transcript", ""))
        )
        
        response = self.llm.invoke([
            SystemMessage(content=prompt),
            HumanMessage(content=evidence_text)
        ])
        
        raw = response.content.strip()
        try:
            data = parse_json_payload(raw)
            decisions, actions = self._validate_evidence_claims(data, state)
        except Exception:
            print("DEBUG: [LangGraph] Node 3 JSON parse failed.", file=sys.stderr)
            decisions = []
            actions = []

        return {"decisions": decisions, "actions": actions}

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
        source_text = "\n".join(segment.get("text", "") for segment in segments)
        source_normalized = self._normalize_evidence_text(source_text)

        decisions = []
        for candidate in data.get("decisions", []):
            quote = candidate.get("evidence_quote") or candidate.get("source_quote")
            if not quote or self._normalize_evidence_text(quote) not in source_normalized:
                continue
            evidence_ids = self._resolve_evidence_ids(
                quote, candidate.get("evidence_segment_ids", []), segment_map
            )
            if not evidence_ids:
                continue
            try:
                decision = Decision(
                    decision=candidate.get("decision") or candidate.get("text") or "",
                    rationale=candidate.get("rationale"),
                    owner=candidate.get("owner"),
                    evidence_segment_ids=evidence_ids,
                    evidence_quote=quote,
                    confidence=self._claim_confidence(candidate),
                    inference=bool(candidate.get("inference", False)),
                ).model_dump()
                decision["text"] = decision["decision"]
                decision["source_quote"] = quote
                decisions.append(decision)
            except Exception as error:
                print(f"DEBUG: [Decision Validation] Rejected claim: {error}", file=sys.stderr)

        actions = []
        for candidate in data.get("actions", data.get("action_items", [])):
            quote = candidate.get("evidence_quote") or candidate.get("source_quote")
            if not quote or self._normalize_evidence_text(quote) not in source_normalized:
                continue
            evidence_ids = self._resolve_evidence_ids(
                quote, candidate.get("evidence_segment_ids", []), segment_map
            )
            if not evidence_ids:
                continue
            try:
                action = ActionItem(
                    task=candidate.get("task") or candidate.get("what") or "",
                    assignee=candidate.get("assignee", candidate.get("who")),
                    due_date=candidate.get("due_date", candidate.get("due")),
                    priority=candidate.get("priority"),
                    status=candidate.get("status", "open"),
                    evidence_segment_ids=evidence_ids,
                    evidence_quote=quote,
                    confidence=self._claim_confidence(candidate),
                    inference=bool(candidate.get("inference", False)),
                ).model_dump()
                action["what"] = action["task"]
                action["who"] = action["assignee"]
                action["due"] = action["due_date"]
                action["source_quote"] = quote
                actions.append(action)
            except Exception as error:
                print(f"DEBUG: [Action Validation] Rejected claim: {error}", file=sys.stderr)

        return decisions, actions

    @staticmethod
    def _normalize_evidence_text(text: str) -> str:
        return " ".join(text.lower().split())

    def _resolve_evidence_ids(self, quote: str, requested_ids: list, segment_map: dict) -> list[str]:
        normalized_quote = self._normalize_evidence_text(quote)
        valid_requested = [
            segment_id for segment_id in requested_ids
            if segment_id in segment_map
            and normalized_quote in self._normalize_evidence_text(segment_map[segment_id].get("text", ""))
        ]
        if valid_requested:
            return valid_requested
        return [
            segment_id for segment_id, segment in segment_map.items()
            if normalized_quote in self._normalize_evidence_text(segment.get("text", ""))
        ]

    @staticmethod
    def _claim_confidence(candidate: dict) -> float:
        try:
            return max(0.0, min(1.0, float(candidate.get("confidence", 0.9))))
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
            "key_decisions, action_items, summary_points.\n"
            "Use empty arrays for missing list fields and empty strings for missing scalar fields."
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

        base_prompt = (
            "You are an expert AI meeting analyst and executive assistant. Your task is to process the following meeting transcript and extract the key information into a highly structured JSON object.\n\n"
            "Follow these strict extraction rules:\n"
            "1. 'metadata.title': Create a short, descriptive title (max 5 words).\n"
            "2. 'tldr': Write exactly ONE sentence capturing the ultimate outcome or bottom line.\n"
            "3. 'metrics': Extract any quantifiable data, numbers, or KPIs mentioned. If none, return an empty array [].\n"
            "4. 'key_decisions': Focus only on finalized choices. Include the rationale behind them.\n"
            "5. Do not create or modify decisions and action items. They are supplied separately as verified claims.\n\n"
            "You MUST output ONLY valid JSON matching the exact schema below. Do not include markdown code blocks, prefaces, or explanations.\n\n"
            "OUTPUT SCHEMA:\n"
            "{\n"
            '  "metadata": {"title": "string", "date": "string", "tags": ["string"]},\n'
            '  "tldr": "string",\n'
            '  "participants": [{"name": "string", "role": "string", "engagement_level": "string"}],\n'
            '  "metrics": [{"label": "string", "value": "string", "trend": "string"}],\n'
            '  "key_decisions": [{"decision": "string", "rationale": "string", "owner": "string"}],\n'
            '  "action_items": [{"task": "string", "assignee": "string", "priority": "string", "status": "string", "due_date": "string"}],\n'
            '  "summary_points": ["string"]\n'
            "}\n"
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

        response = self.llm.invoke([
            SystemMessage(content=prompt),
            HumanMessage(content=content_block)
        ])

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

        return {
            "final_markdown": "",
            "structured_summary": structured,
        }

    def run(
        self,
        transcript: str,
        diarized_segments: list = None,
        meeting_date: str = None,
        transcript_segments: list = None,
    ) -> dict:
        """Builds the graph, compiles it, and runs the transcript through the nodes."""
        
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
            
            merged_entities = {"speakers": [], "numbers": [], "dates": [], "projects": [], "acronyms": []}
            merged_decisions = []
            merged_actions = []
            merged_clean = ""
            
            for i, chunk_segments in enumerate(segment_chunks):
                print(f"DEBUG: [LangGraph] Processing chunk {i+1}/{len(segment_chunks)}", file=sys.stderr)
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

            merged_decisions = self._deduplicate_claims(merged_decisions, "decision")
            merged_actions = self._deduplicate_claims(merged_actions, "task")
                
            final_state = {
                "entities": merged_entities,
                "clean_transcript": merged_clean.strip(),
                "decisions": merged_decisions,
                "actions": merged_actions,
                "transcript_segments": source_segments,
            }
            res_s = self.generate_summary_node(final_state)
            return {
                "markdown": res_s.get("final_markdown", ""),
                "structured": res_s.get("structured_summary", {}),
            }
        else:
            print("DEBUG: [LangGraph] Building and compiling workflow graph...", file=sys.stderr)
            
            workflow = StateGraph(AgentState)
            workflow.add_node("extraction_entities", self.extract_entities_node)
            workflow.add_node("cleanup", self.clean_transcript_node)
            workflow.add_node("extraction_actions", self.extract_action_items_node)
            workflow.add_node("summary", self.generate_summary_node)
            
            workflow.add_edge(START, "extraction_entities")
            workflow.add_edge("extraction_entities", "cleanup")
            workflow.add_edge("cleanup", "extraction_actions")
            workflow.add_edge("extraction_actions", "summary")
            workflow.add_edge("summary", END)
            
            app = workflow.compile()
            try:
                print("DEBUG: [LangGraph] Executing workflow...", file=sys.stderr)
                result = app.invoke({
                    "raw_transcript": transcript,
                    "diarized_segments": diarized_segments,
                    "transcript_segments": transcript_segments or self._segments_from_text(transcript),
                    "meeting_date": meeting_date or "",
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
    ) -> dict:
        try:
            engine = MeetingWorkflowEngine(
                self.provider_name, self.model_name,
                api_key=api_key, system_prompt=system_prompt
            )
            return engine.run(
                transcription,
                diarized_segments=diarized_segments,
                meeting_date=meeting_date,
                transcript_segments=transcript_segments,
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
