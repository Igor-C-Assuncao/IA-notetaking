# src-python/llm_service.py
import sys
import os
import time
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from langchain_core.messages import SystemMessage, HumanMessage
import json as json_lib
from config import DEFAULTS

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


# ---------------------------------------------------------
# GRAPH STATE DEFINITION
# ---------------------------------------------------------
class AgentState(TypedDict):
    """Represents the memory/state of our LangGraph workflow."""
    raw_transcript: str
    diarized_segments: list | None
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
            if not self.api_key: raise ValueError("OpenAI API key is missing.")
            from langchain_openai import ChatOpenAI
            return ChatOpenAI(model=self.model_name, api_key=self.api_key, temperature=temp)
            
        elif self.provider_name == "gemini":
            if not self.api_key: raise ValueError("Gemini API key is missing.")
            from langchain_google_genai import ChatGoogleGenerativeAI
            return ChatGoogleGenerativeAI(model=self.model_name, google_api_key=self.api_key, temperature=temp)
            
        elif self.provider_name == "anthropic":
            if not self.api_key: raise ValueError("Anthropic API key is missing.")
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
            cleaned_raw = extract_json_payload(raw)
            entities = json_lib.loads(cleaned_raw)
            # Ensure safe fallback keys
            for k in ["speakers", "numbers", "dates", "projects", "acronyms"]:
                if k not in entities: entities[k] = []
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
            "Analyze the meeting transcript and extract ONLY decisions made and action items.\n"
            "Rules:\n"
            "1. Decisions are concrete choices made (e.g., 'we will go with Postgres').\n"
            "2. Action items are tasks. 'who' MUST be a person from the transcript or null.\n"
            "3. Every decision and action MUST include a 'source_quote': a verbatim <=25 word substring from the transcript that proves it.\n\n"
            "Return ONLY a JSON object matching this schema:\n"
            "{\n"
            '  "decisions": [{"text": "string", "source_quote": "string"}],\n'
            '  "actions": [{"who": "string|null", "what": "string", "due": "string|null", "source_quote": "string"}]\n'
            "}\n"
        )
        
        response = self.llm.invoke([
            SystemMessage(content=prompt),
            HumanMessage(content=state.get("clean_transcript", ""))
        ])
        
        raw = response.content.strip()
        try:
            cleaned_raw = extract_json_payload(raw)
            data = json_lib.loads(cleaned_raw)
            decisions = data.get("decisions", [])
            actions = data.get("actions", [])
        except Exception:
            print("DEBUG: [LangGraph] Node 3 JSON parse failed.", file=sys.stderr)
            decisions = []
            actions = []

        return {"decisions": decisions, "actions": actions}

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
            "5. 'action_items': Extract distinct tasks. Infer the assignee and priority (High, Medium, Low) based on the context.\n\n"
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
            cleaned_raw = extract_json_payload(raw)
            structured = json_lib.loads(cleaned_raw)
        except Exception:
            print("DEBUG: [LangGraph] Node 4 JSON parse failed.", file=sys.stderr)
            structured = {
                "metadata": {"title": "Summary", "date": "", "tags": []},
                "tldr": "Failed to generate structured summary.",
                "participants": [],
                "metrics": [],
                "key_decisions": [],
                "action_items": [],
                "summary_points": []
            }

        return {
            "final_markdown": "",
            "structured_summary": structured,
        }

    def run(self, transcript: str, diarized_segments: list = None, meeting_date: str = None) -> dict:
        """Builds the graph, compiles it, and runs the transcript through the nodes."""
        
        # Token estimation & Map-Reduce check
        char_count = len(transcript)
        tokens_per_char = DEFAULTS["tokens_per_char"]
        est_tokens = char_count / tokens_per_char
        threshold = DEFAULTS["num_ctx"] * 0.6
        
        print(f"DEBUG: [LangGraph] Estimated tokens: {est_tokens:.1f} (Threshold: {threshold})", file=sys.stderr)
        
        if est_tokens > threshold:
            print("DEBUG: [LangGraph] Long meeting detected. Applying map-reduce chunking...", file=sys.stderr)
            # Simplified map-reduce chunking for now (splits in half roughly)
            # In a full production scenario, we'd split by VAD silences
            mid = len(transcript) // 2
            chunks = [transcript[:mid], transcript[mid:]]
            
            merged_entities = {"speakers": [], "numbers": [], "dates": [], "projects": [], "acronyms": []}
            merged_decisions = []
            merged_actions = []
            merged_clean = ""
            
            for i, chunk in enumerate(chunks):
                print(f"DEBUG: [LangGraph] Processing chunk {i+1}/{len(chunks)}", file=sys.stderr)
                chunk_state = {
                    "raw_transcript": chunk,
                    "diarized_segments": diarized_segments,
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
                
            final_state = {
                "entities": merged_entities,
                "clean_transcript": merged_clean.strip(),
                "decisions": merged_decisions,
                "actions": merged_actions,
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

    def generate_notes(self, transcription: str, api_key: str = None, system_prompt: str = None, diarized_segments: list = None, meeting_date: str = None) -> dict:
        try:
            engine = MeetingWorkflowEngine(
                self.provider_name, self.model_name,
                api_key=api_key, system_prompt=system_prompt
            )
            return engine.run(transcription, diarized_segments=diarized_segments, meeting_date=meeting_date)
        except Exception as e:
            return {"markdown": f"[LangGraph Error: {str(e)}]", "structured": {}}

class LLMFactory:
    @staticmethod
    def get_provider(provider_name: str, model_config: str = None) -> LangGraphStrategy:
        """
        Returns the LangGraph Strategy configured for the chosen provider.
        """
        provider_name = provider_name.lower()
        
        # Set default models if none provided by the frontend
        if provider_name == "ollama" and not model_config:
            model_config = DEFAULTS["model"]
        elif provider_name == "openai" and not model_config:
            model_config = "gpt-4o"
        elif provider_name == "gemini" and not model_config:
            model_config = "gemini-2.5-flash"
        elif provider_name == "anthropic" and not model_config:
            model_config = "claude-3-haiku-20240307"
            
        return LangGraphStrategy(provider_name, model_config)