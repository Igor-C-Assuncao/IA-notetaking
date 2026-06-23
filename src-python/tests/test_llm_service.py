import json
from unittest.mock import MagicMock
from llm_service import MeetingWorkflowEngine, LLMFactory, parse_json_payload

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
        "actions": [{"who": "Bob", "what": "finalize schema", "due": "tomorrow", "source_quote": "finalize the schema by tomorrow"}]
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
    assert res["actions"][0]["evidence_segment_ids"] == ["seg_000000"]
    assert res["actions"][0]["confidence"] == 0.9

def test_extract_action_items_rejects_unsupported_quote(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm

    mock_response = MagicMock()
    mock_response.content = json.dumps({
        "decisions": [],
        "actions": [{
            "task": "Delete production",
            "evidence_quote": "we agreed to delete production",
            "evidence_segment_ids": ["seg_000000"],
            "confidence": 0.99,
            "inference": False,
        }],
    })
    mock_llm.invoke.return_value = mock_response

    state = {
        "raw_transcript": "Alice: We agreed to keep production online.",
        "transcript_segments": [{
            "segment_id": "seg_000000",
            "text": "We agreed to keep production online.",
        }],
    }

    res = engine.extract_action_items_node(state)
    assert res["actions"] == []

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
        "metadata": {"title": "DB Launch", "date": "2026-05-24", "tags": ["db", "launch"]},
        "tldr": "We decided to deploy database.",
        "participants": [],
        "metrics": [],
        "key_decisions": [{"decision": "Adopt Postgres", "rationale": "Better performance", "owner": "Alice"}],
        "action_items": [],
        "summary_points": []
    })
    mock_llm.invoke.return_value = mock_response
    
    state = {
        "entities": {"numbers": [], "speakers": []},
        "decisions": [{"text": "Adopt Postgres"}],
        "actions": []
    }
    
    res = engine.generate_summary_node(state)
    assert res["structured_summary"]["tldr"] == "We decided to deploy database."
    assert "launch" in res["structured_summary"]["metadata"]["tags"]
    assert res["final_markdown"] == ""

def test_generate_summary_node_fallback(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm
    
    mock_response = MagicMock()
    mock_response.content = "Unparseable summary raw body"
    mock_llm.invoke.return_value = mock_response
    
    state = {
        "entities": {},
        "decisions": [],
        "actions": [],
        "clean_transcript": "Alice confirmed the launch plan. Bob will update the checklist.",
    }
    
    res = engine.generate_summary_node(state)
    assert res["structured_summary"]["tldr"] == "Alice confirmed the launch plan."
    assert res["structured_summary"]["summary_generation_warning"]
    assert res["final_markdown"] == ""

def test_generate_summary_node_repairs_invalid_json(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm

    broken_response = MagicMock()
    broken_response.content = "Here is the summary: {metadata: bad json"
    repaired_response = MagicMock()
    repaired_response.content = json.dumps({
        "metadata": {"title": "Launch", "date": "", "tags": ["release"]},
        "tldr": "The launch plan was confirmed.",
        "participants": [],
        "metrics": [],
        "key_decisions": [],
        "action_items": [],
        "summary_points": ["Launch plan confirmed."]
    })
    mock_llm.invoke.side_effect = [broken_response, repaired_response]

    state = {
        "entities": {"numbers": [], "speakers": []},
        "decisions": [],
        "actions": [],
        "clean_transcript": "Alice confirmed the launch plan.",
    }

    res = engine.generate_summary_node(state)
    assert res["structured_summary"]["tldr"] == "The launch plan was confirmed."
    assert res["structured_summary"]["summary_generation_warning"] == "LLM summary JSON was repaired before rendering."
    assert mock_llm.invoke.call_count == 2

def test_parse_json_payload_repairs_trailing_commas():
    parsed = parse_json_payload('```json\n{"tldr": "Done", "summary_points": ["A",],}\n```')
    assert parsed["tldr"] == "Done"
    assert parsed["summary_points"] == ["A"]

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


def test_chunk_transcript_segments_preserves_boundaries_and_overlap():
    segments = [
        {"segment_id": "seg_1", "text": "First complete thought."},
        {"segment_id": "seg_2", "text": "Second complete thought."},
        {"segment_id": "seg_3", "text": "Third complete thought."},
    ]

    chunks = MeetingWorkflowEngine._chunk_transcript_segments(
        segments,
        max_chars=45,
        overlap_segments=1,
    )

    assert [[segment["segment_id"] for segment in chunk] for chunk in chunks] == [
        ["seg_1"],
        ["seg_1", "seg_2"],
        ["seg_2", "seg_3"],
    ]


def test_deduplicate_claims_uses_text_and_evidence():
    claims = [
        {"task": "Send the report", "evidence_segment_ids": ["seg_1"]},
        {"task": " send   the report ", "evidence_segment_ids": ["seg_1"]},
        {"task": "Send the report", "evidence_segment_ids": ["seg_2"]},
    ]

    deduplicated = MeetingWorkflowEngine._deduplicate_claims(claims, "task")

    assert len(deduplicated) == 2
