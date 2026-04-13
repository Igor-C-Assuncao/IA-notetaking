# src-python/llm_service.py
import sys
import os
from typing import TypedDict
from langgraph.graph import StateGraph, START, END
from langchain_core.messages import SystemMessage, HumanMessage

# ---------------------------------------------------------
# GRAPH STATE DEFINITION
# ---------------------------------------------------------
class AgentState(TypedDict):
    """Represents the memory/state of our LangGraph workflow."""
    raw_transcript: str
    clean_transcript: str
    action_items: str
    final_markdown: str

# ---------------------------------------------------------
# LANGGRAPH WORKFLOW ENGINE
# ---------------------------------------------------------
class MeetingWorkflowEngine:
    """
    Constructs and executes a multi-node AI workflow to process transcripts.
    Supports local (Ollama) and cloud (OpenAI, Gemini, Anthropic) models.
    """
    def __init__(self, provider_name: str, model_name: str, api_key: str = None):
        self.provider_name = provider_name.lower()
        self.model_name = model_name
        self.api_key = api_key
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

    # --- NODE 3: Final Markdown Formatting ---
    def generate_summary_node(self, state: AgentState):
        print("DEBUG: [LangGraph] Node 3: Generating final Markdown summary...", file=sys.stderr)
        prompt = (
            "You are an executive assistant. Construct a highly professional meeting summary in Markdown.\n\n"
            "REQUIREMENTS:\n"
            "1. Start with '## 📝 Executive Summary' (1 paragraph overview).\n"
            "2. Follow with '## 🔑 Key Takeaways' (bullet points of main discussions).\n"
            "3. End with '## 🎯 Action Items' (insert the provided action items directly).\n\n"
            "Use the provided cleaned transcript and action items to build this. Output ONLY the Markdown."
        )
        content_block = f"TRANSCRIPT:\n{state['clean_transcript']}\n\nACTION ITEMS:\n{state['action_items']}"
        
        response = self.llm.invoke([
            SystemMessage(content=prompt),
            HumanMessage(content=content_block)
        ])
        return {"final_markdown": response.content}

    def run(self, transcript: str) -> str:
        """Builds the graph, compiles it, and runs the transcript through the nodes."""
        print("DEBUG: [LangGraph] Building and compiling workflow graph...", file=sys.stderr)
        
        # 1. Initialize Graph
        workflow = StateGraph(AgentState)
        
        # 2. Add Nodes
        workflow.add_node("cleanup", self.clean_transcript_node)
        workflow.add_node("extraction", self.extract_action_items_node)
        workflow.add_node("summary", self.generate_summary_node)
        
        # 3. Define Edges (The Pipeline Flow)
        workflow.add_edge(START, "cleanup")
        workflow.add_edge("cleanup", "extraction")
        workflow.add_edge("extraction", "summary")
        workflow.add_edge("summary", END)
        
        # 4. Compile and Execute
        app = workflow.compile()
        try:
            print("DEBUG: [LangGraph] Executing workflow...", file=sys.stderr)
            result = app.invoke({"raw_transcript": transcript})
            return result["final_markdown"]
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

    def generate_notes(self, transcription: str, api_key: str = None) -> str:
        try:
            engine = MeetingWorkflowEngine(self.provider_name, self.model_name, api_key)
            return engine.run(transcription)
        except Exception as e:
            return f"[LangGraph Error: {str(e)}]"

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