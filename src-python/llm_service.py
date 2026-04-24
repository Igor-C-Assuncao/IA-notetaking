# src-python/llm_service.py
import sys
import os
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from langchain_core.messages import SystemMessage, HumanMessage

# ---------------------------------------------------------
# GRAPH STATE DEFINITION
# ---------------------------------------------------------
import json as json_lib

class AgentState(TypedDict):
    """Represents the memory/state of our LangGraph workflow."""
    raw_transcript: str
    clean_transcript: str
    action_items: str
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
        
        # We use temperature=0.1 for analytical tasks to reduce hallucinations
        temp = 0.1 

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

    # --- NODE 1: Transcript Cleanup ---
    def clean_transcript_node(self, state: AgentState):
        print("DEBUG: [LangGraph] Node 1: Cleaning transcript...", file=sys.stderr)
        prompt = (
            "You are an editor. Fix grammar, typos, and remove filler words (e.g., 'uh', 'um', 'like') "
            "from the following meeting transcript. Keep the original meaning intact. "
            "Return ONLY the cleaned text, without any conversational filler."
        )
        response = self.llm.invoke([
            SystemMessage(content=prompt),
            HumanMessage(content=state["raw_transcript"])
        ])
        return {"clean_transcript": response.content}

    # --- NODE 2: Action Item Extraction ---
    def extract_action_items_node(self, state: AgentState):
        print("DEBUG: [LangGraph] Node 2: Extracting action items...", file=sys.stderr)
        prompt = (
            "Analyze the meeting transcript and extract ONLY decisions made and action items. "
            "If someone is assigned a task, explicitly state their name. "
            "Format as a simple bulleted list. If no action items exist, reply 'None identified.'"
        )
        response = self.llm.invoke([
            SystemMessage(content=prompt),
            HumanMessage(content=state["clean_transcript"])
        ])
        return {"action_items": response.content}

    # --- NODE 3: Structured Summary (JSON) + Markdown fallback ---
    def generate_summary_node(self, state: AgentState):
        print("DEBUG: [LangGraph] Node 3: Generating structured summary...", file=sys.stderr)

        base_prompt = (
            "You are an executive assistant. Analyze the meeting transcript and action items below "
            "and return a structured JSON object — nothing else, no markdown fences, no commentary.\n\n"
            "The JSON MUST follow this exact schema:\n"
            "{\n"
            '  "tldr": "One sentence that captures the core outcome of the meeting.",\n'
            '  "decisions": ["Decision 1", "Decision 2"],\n'
            '  "actions": [\n'
            '    {"who": "Name or null", "text": "Task description", "due": "Due date or null"}\n'
            "  ],\n"
            '  "tags": ["tag1", "tag2"],\n'
            '  "markdown": "## 📝 Executive Summary\\n...full markdown summary..."\n'
            "}\n\n"
            "Rules:\n"
            "- tldr: single sentence, no more than 25 words.\n"
            "- decisions: concrete choices made, not discussion points. Empty array if none.\n"
            "- actions: tasks with an owner and optionally a due date. who/due may be null.\n"
            "- tags: 2-5 lowercase hyphenated topic labels (e.g. 'product', 'q2-planning').\n"
            "- markdown: full professional summary with Executive Summary, Key Takeaways, and Action Items sections.\n"
            "Output ONLY the raw JSON object."
        )

        if self.system_prompt:
            prompt = f"{self.system_prompt}\n\n{base_prompt}"
        else:
            prompt = base_prompt

        content_block = f"TRANSCRIPT:\n{state['clean_transcript']}\n\nACTION ITEMS:\n{state['action_items']}"

        response = self.llm.invoke([
            SystemMessage(content=prompt),
            HumanMessage(content=content_block)
        ])

        raw = response.content.strip()

        # Strip markdown fences if model wrapped the JSON anyway
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
            raw = raw.strip()

        try:
            structured = json_lib.loads(raw)
        except Exception:
            # Fallback: treat the whole response as markdown
            print("DEBUG: [LangGraph] JSON parse failed, falling back to markdown.", file=sys.stderr)
            structured = {
                "tldr": None,
                "decisions": [],
                "actions": [],
                "tags": [],
                "markdown": raw,
            }

        return {
            "final_markdown": structured.get("markdown", raw),
            "structured_summary": structured,
        }

    def run(self, transcript: str) -> dict:
        """Builds the graph, compiles it, and runs the transcript through the nodes."""
        print("DEBUG: [LangGraph] Building and compiling workflow graph...", file=sys.stderr)
        
        workflow = StateGraph(AgentState)
        workflow.add_node("cleanup", self.clean_transcript_node)
        workflow.add_node("extraction", self.extract_action_items_node)
        workflow.add_node("summary", self.generate_summary_node)
        workflow.add_edge(START, "cleanup")
        workflow.add_edge("cleanup", "extraction")
        workflow.add_edge("extraction", "summary")
        workflow.add_edge("summary", END)
        
        app = workflow.compile()
        try:
            print("DEBUG: [LangGraph] Executing workflow...", file=sys.stderr)
            result = app.invoke({"raw_transcript": transcript})
            return {
                "markdown": result["final_markdown"],
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

    def generate_notes(self, transcription: str, api_key: str = None, system_prompt: str = None) -> dict:
        try:
            engine = MeetingWorkflowEngine(
                self.provider_name, self.model_name,
                api_key=api_key, system_prompt=system_prompt
            )
            return engine.run(transcription)
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
            model_config = "llama3"
        elif provider_name == "openai" and not model_config:
            model_config = "gpt-4o"
        elif provider_name == "gemini" and not model_config:
            model_config = "gemini-2.5-flash"
        elif provider_name == "anthropic" and not model_config:
            model_config = "claude-3-haiku-20240307"
            
        return LangGraphStrategy(provider_name, model_config)