# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 Igor Cassimiro Assunção
import json

from config import get_app_data_dir, load_model_manifest
from rag_service import RAGService


def test_model_manifest_declares_required_defaults():
    manifest = load_model_manifest()

    assert manifest["version"] == 1
    assert manifest["transcription"]["default"]["name"]
    assert manifest["embeddings"]["ollama"]["name"]
    assert manifest["llm_defaults"]["ollama"]


def test_app_data_dir_can_be_overridden(monkeypatch, tmp_path):
    monkeypatch.setenv("AI_NOTETAKING_DATA_DIR", str(tmp_path))

    assert get_app_data_dir() == tmp_path
    assert tmp_path.exists()


def test_rag_index_uses_app_data_directory(monkeypatch, tmp_path):
    monkeypatch.setenv("AI_NOTETAKING_DATA_DIR", str(tmp_path))

    service = RAGService()

    assert service.index_path == str(tmp_path / "rag" / "vector_index.json")
    assert service.vectors_path == str(tmp_path / "rag" / "vector_index.npy")
    assert (tmp_path / "rag").exists()


def test_model_manifest_is_valid_json():
    # Guards the release metadata file against hand-edited malformed JSON.
    manifest = load_model_manifest()
    json.dumps(manifest)
