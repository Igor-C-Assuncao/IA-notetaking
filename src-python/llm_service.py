# src-python/llm_service.py
import sys
import json
import os
import requests
from abc import ABC, abstractmethod

# Cloud SDKs
from openai import OpenAI
from anthropic import Anthropic
from google import genai

# ---------------------------------------------------------
# THE UNIVERSAL PROMPT
# ---------------------------------------------------------
SYSTEM_PROMPT = """You are an expert executive assistant. Analyze the following meeting transcription and provide a structured summary in Markdown format.
Include exactly these three sections:
## 📝 Executive Summary
A brief, one-paragraph overview of the meeting's main objective and outcome.

## 🔑 Key Takeaways
Bullet points of the most important discussions and decisions.

## 🎯 Action Items
A checklist of tasks, clearly identifying who is responsible (if mentioned) and the next steps.

Format using standard Markdown. Do not include any text outside of these sections."""

# ---------------------------------------------------------
# STRATEGY PATTERN: The abstract interface
# ---------------------------------------------------------
class LLMStrategy(ABC):
    @abstractmethod
    def generate_notes(self, transcription: str, api_key: str = None) -> str:
        """Processes the transcription and returns structured Markdown notes."""
        pass

# ---------------------------------------------------------
# CONCRETE STRATEGIES: The Providers
# ---------------------------------------------------------
class OllamaStrategy(LLMStrategy):
    """Local AI processing using Ollama (Requires Ollama running on localhost)."""
    def __init__(self, model_name="llama3"):
        self.model_name = model_name
        self.url = "http://localhost:11434/api/generate"

    def generate_notes(self, transcription: str, api_key: str = None) -> str:
        print(f"DEBUG: [LLM] Routing request to LOCAL OLLAMA ({self.model_name})...", file=sys.stderr)
        
        payload = {
            "model": self.model_name,
            "system": SYSTEM_PROMPT,
            "prompt": f"Transcription:\n{transcription}",
            "stream": False
        }
        
        try:
            response = requests.post(self.url, json=payload, timeout=120)
            response.raise_for_status()
            result = response.json()
            return result.get("response", "[Error: Empty response from Ollama]")
        except requests.exceptions.ConnectionError:
            return "[Error: Ollama is not running. Please start the Ollama desktop app.]"
        except Exception as e:
            return f"[Error connecting to Ollama: {str(e)}]"

class OpenAIStrategy(LLMStrategy):
    """Cloud AI processing using OpenAI (GPT-4o or GPT-3.5)."""
    def __init__(self, model_name="gpt-4o"):
        self.model_name = model_name

    def generate_notes(self, transcription: str, api_key: str = None) -> str:
        print(f"DEBUG: [LLM] Routing request to OPENAI ({self.model_name})...", file=sys.stderr)
        if not api_key:
            return "[Error: OpenAI API Key is missing.]"
            
        try:
            client = OpenAI(api_key=api_key)
            response = client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"Transcription:\n{transcription}"}
                ]
            )
            return response.choices[0].message.content
        except Exception as e:
            return f"[OpenAI Error: {str(e)}]"

class GeminiStrategy(LLMStrategy):
    """Cloud AI processing using Google Gemini."""
    def __init__(self, model_name="gemini-2.5-flash"):
        self.model_name = model_name

    def generate_notes(self, transcription: str, api_key: str = None) -> str:
        print(f"DEBUG: [LLM] Routing request to GOOGLE GEMINI ({self.model_name})...", file=sys.stderr)
        if not api_key:
            return "[Error: Gemini API Key is missing.]"
            
        try:
            client = genai.Client(api_key=api_key)
            response = client.models.generate_content(
                model=self.model_name,
                contents=f"{SYSTEM_PROMPT}\n\nTranscription:\n{transcription}"
            )
            return response.text
        except Exception as e:
            return f"[Gemini Error: {str(e)}]"

# ---------------------------------------------------------
# FACTORY METHOD: Instantiates the chosen provider
# ---------------------------------------------------------
class LLMFactory:
    @staticmethod
    def get_provider(provider_name: str, model_config: str = None) -> LLMStrategy:
        """
        Returns the appropriate LLM strategy based on user configuration.
        """
        provider_name = provider_name.lower()
        
        if provider_name == "ollama":
            # Default to llama3 if user didn't specify a local model
            return OllamaStrategy(model_name=model_config or "llama3")
        elif provider_name == "openai":
            return OpenAIStrategy(model_name=model_config or "gpt-4o")
        elif provider_name == "gemini":
            return GeminiStrategy(model_name=model_config or "gemini-2.5-flash")
        else:
            raise ValueError(f"Unsupported LLM provider: {provider_name}")