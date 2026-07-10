# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Igor Cassimiro Assunção
import json
import os
import platform
from pathlib import Path


ROOT_DIR = Path(__file__).resolve().parent
MODEL_MANIFEST_PATH = ROOT_DIR / "model_manifest.json"


def get_app_data_dir() -> Path:
    override = os.environ.get("AI_NOTETAKING_DATA_DIR")
    if override:
        app_dir = Path(override).expanduser()
    else:
        system = platform.system()
        if system == "Windows":
            base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
        elif system == "Darwin":
            base = Path.home() / "Library" / "Application Support"
        else:
            base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
        app_dir = base / "com.opensource.ainotetaker"
    app_dir.mkdir(parents=True, exist_ok=True)
    return app_dir


def load_model_manifest(path: Path = MODEL_MANIFEST_PATH) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def get_manifest_model(section: str, key: str, default: str) -> str:
    manifest = load_model_manifest()
    model = manifest.get(section, {}).get(key, {})
    return model.get("name") or default


# Centralized configuration defaults for AI NoteTaking

DEFAULTS = {
    # ── LLM & Inference Defaults ───────────────────────────────────────────
    "provider": "ollama",
    "model": "llama3.1:8b",
    
    # LangChain / LangGraph parameters for summarization & extraction
    "temperature": 0.2,
    "num_predict": 2048,
    "num_ctx": 16384,
    "top_p": 0.9,
    "repeat_penalty": 1.1,
    "tokens_per_char": 3.5,

    # ── Transcription Defaults ─────────────────────────────────────────────
    "whisper_model": get_manifest_model("transcription", "default", "base"),
    "language": "auto",
    
    # ── Application Defaults ───────────────────────────────────────────────
    "system_audio": False,
    "auto_summarize": True,
    "speaker_diarization": False,
}
