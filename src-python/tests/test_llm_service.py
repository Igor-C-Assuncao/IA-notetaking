import pytest
import json
from unittest.mock import MagicMock
from llm_service import MeetingWorkflowEngine, LangGraphStrategy, LLMFactory

def test_extract_entities_node_success(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm
    
    # Mocking successful entity JSON response
    mock_response = MagicMock()
    mock_response.content = json.dumps({
        "speakers": [{"name": "Alice", "role_hint": "Developer", "first_mention_idx": 0}],
        "numbers": [{"value": "100", "context": "users", "category": "other"}],
        "dates": [],
        "projects": ["IA-notetaking"],
        "acronyms": []
    })
    mock_llm.invoke.return_value = mock_response
    
    state = {
        "raw_transcript": "Alice: Hello, we have 100 users on IA-notetaking.",
        "meeting_date": "2026-05-24"
    }
    
    res = engine.extract_entities_node(state)
    assert "entities" in res
    assert res["entities"]["speakers"][0]["name"] == "Alice"
    assert "IA-notetaking" in res["entities"]["projects"]

def test_extract_entities_node_json_fallback(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm
    
    # Mocking broken JSON
    mock_response = MagicMock()
    mock_response.content = "This is not json { broken: "
    mock_llm.invoke.return_value = mock_response
    
    state = {
        "raw_transcript": "Alice: Hi",
        "meeting_date": "2026-05-24"
    }
    
    res = engine.extract_entities_node(state)
    assert "entities" in res
    # Ensure safe fallback keys exist
    assert res["entities"]["speakers"] == []
    assert res["entities"]["projects"] == []

def test_clean_transcript_node_with_diarization(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm
    
    mock_response = MagicMock()
    mock_response.content = "**Alice:** Hello there"
    mock_llm.invoke.return_value = mock_response
    
    state = {
        "raw_transcript": "Hello there",
        "diarized_segments": [{"speaker": "SPEAKER_00", "text": "Hello there"}],
        "entities": {"speakers": [{"name": "Alice", "role_hint": None, "first_mention_idx": 0}]}
    }
    
    res = engine.clean_transcript_node(state)
    assert res["clean_transcript"] == "**Alice:** Hello there"

def test_clean_transcript_node_without_diarization(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm
    
    mock_response = MagicMock()
    mock_response.content = "Cleaned raw script."
    mock_llm.invoke.return_value = mock_response
    
    state = {
        "raw_transcript": "Raw text uh filled with fillers.",
        "diarized_segments": None
    }
    
    res = engine.clean_transcript_node(state)
    assert res["clean_transcript"] == "Cleaned raw script."

def test_extract_action_items_node_success(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm
    
    mock_response = MagicMock()
    mock_response.content = json.dumps({
        "decisions": [{"text": "Adopt Postgres", "source_quote": "we will go with postgres"}],
        "actions": [{"who": "Bob", "what": "finalize schema", "due": "tomorrow", "source_quote": "finalize schema by tomorrow"}]
    })
    mock_llm.invoke.return_value = mock_response
    
    state = {
        "clean_transcript": "**Bob:** I will finalize the schema by tomorrow. We will go with postgres."
    }
    
    res = engine.extract_action_items_node(state)
    assert len(res["decisions"]) == 1
    assert len(res["actions"]) == 1
    assert res["decisions"][0]["text"] == "Adopt Postgres"
    assert res["actions"][0]["who"] == "Bob"

def test_extract_action_items_node_fallback(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm
    
    mock_response = MagicMock()
    mock_response.content = "Broken data"
    mock_llm.invoke.return_value = mock_response
    
    state = {"clean_transcript": "Text"}
    res = engine.extract_action_items_node(state)
    assert res["decisions"] == []
    assert res["actions"] == []

def test_generate_summary_node_with_custom_prompt(mock_llm):
    # Pass a custom system prompt to check inclusion
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3", system_prompt="Focus on project metrics.")
    engine.llm = mock_llm
    
    mock_response = MagicMock()
    mock_response.content = json.dumps({
        "tldr": "We decided to deploy database.",
        "tags": ["db", "launch"],
        "markdown": "## 📝 TL;DR\nWe decided to deploy database.\n\n## ✅ Decisions\n- Adopt Postgres"
    })
    mock_llm.invoke.return_value = mock_response
    
    state = {
        "entities": {"numbers": [], "speakers": []},
        "decisions": [{"text": "Adopt Postgres"}],
        "actions": []
    }
    
    res = engine.generate_summary_node(state)
    assert res["structured_summary"]["tldr"] == "We decided to deploy database."
    assert "launch" in res["structured_summary"]["tags"]
    assert res["final_markdown"].startswith("## 📝")

def test_generate_summary_node_fallback(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm
    
    mock_response = MagicMock()
    mock_response.content = "Unparseable summary raw body"
    mock_llm.invoke.return_value = mock_response
    
    state = {
        "entities": {},
        "decisions": [],
        "actions": []
    }
    
    res = engine.generate_summary_node(state)
    assert res["structured_summary"]["tldr"] is None
    assert res["final_markdown"] == "Unparseable summary raw body"

def test_langgraph_strategy_and_llm_factory(mock_llm, monkeypatch):
    # Mocking MeetingWorkflowEngine.run to avoid building full graphs during simple checks
    monkeypatch.setattr(MeetingWorkflowEngine, "_initialize_llm", lambda self: mock_llm)
    
    mock_response = MagicMock()
    mock_response.content = json.dumps({
        "tldr": "Done",
        "tags": [],
        "markdown": "Markdown summary"
    })
    mock_llm.invoke.return_value = mock_response
    
    # Factory checks
    strategy = LLMFactory.get_provider("ollama")
    assert strategy.provider_name == "ollama"
    
    res = strategy.generate_notes("Alice: Hello")
    assert "markdown" in res
    assert "structured" in res

def test_meeting_workflow_engine_long_map_reduce(mock_llm, monkeypatch):
    monkeypatch.setattr(MeetingWorkflowEngine, "_initialize_llm", lambda self: mock_llm)
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    
    # Setup mock responses for nodes during map-reduce split runs
    mock_response = MagicMock()
    mock_response.content = json.dumps({
        "speakers": [],
        "numbers": [],
        "dates": [],
        "projects": [],
        "acronyms": []
    })
    mock_llm.invoke.return_value = mock_response
    
    # Make text long enough to trigger map-reduce threshold (> 8000*0.6 = 4800 chars)
    long_transcript = "Alice: Hello " * 500
    
    res = engine.run(long_transcript)
    assert "markdown" in res
    assert "structured" in res
