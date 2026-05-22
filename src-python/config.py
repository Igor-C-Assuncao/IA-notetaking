# src-python/config.py

# Centralized configuration defaults for AI NoteTaking

DEFAULTS = {
    # ── LLM & Inference Defaults ───────────────────────────────────────────
    "provider": "ollama",
    "model": "gemma4:e2b",
    
    # LangChain / LangGraph parameters for summarization & extraction
    "temperature": 0.2,
    "num_predict": 2048,
    "num_ctx": 16384,
    "top_p": 0.9,
    "repeat_penalty": 1.1,

    # ── Transcription Defaults ─────────────────────────────────────────────
    "whisper_model": "base",
    "language": "auto",
    
    # ── Application Defaults ───────────────────────────────────────────────
    "system_audio": False,
    "auto_summarize": True,
    "speaker_diarization": False,
}
