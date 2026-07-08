import json
from unittest.mock import MagicMock
from llm_service import (
    LLMFactory,
    MeetingWorkflowEngine,
    find_recurring_open_actions,
    find_recurring_topics,
    parse_json_payload,
    rank_previous_meetings,
)
from schemas import (
    ActionCandidate,
    ChapterCandidate,
    ChapterExtraction,
    ChangedDecision,
    ClaimExtraction,
    ContinuityAnalysis,
    FollowUpEmail,
    RecurringAction,
    StructuredMeetingSummary,
)

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
    # Claims without an explicit confidence default to neutral 0.5, not high
    assert res["actions"][0]["confidence"] == 0.5

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

def test_extract_action_items_accepts_paraphrased_quote_as_inference(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm

    segment_text = "Bob will, um, update the deployment checklist before the big release."
    mock_response = MagicMock()
    mock_response.content = json.dumps({
        "decisions": [],
        "actions": [{
            "task": "Update the deployment checklist",
            "evidence_quote": "Bob will update the deployment checklist before the release",
            "evidence_segment_ids": ["seg_000000"],
            "confidence": 0.95,
            "inference": False,
        }],
    })
    mock_llm.invoke.return_value = mock_response

    state = {
        "raw_transcript": segment_text,
        "transcript_segments": [{
            "segment_id": "seg_000000",
            "text": segment_text,
        }],
    }

    res = engine.extract_action_items_node(state)
    assert len(res["actions"]) == 1
    action = res["actions"][0]
    # Paraphrased evidence is downgraded, not silently dropped
    assert action["inference"] is True
    assert action["confidence"] < 0.95
    # The displayed quote is the real transcript text, not the paraphrase
    assert action["evidence_quote"] == segment_text.strip()
    assert action["evidence_segment_ids"] == ["seg_000000"]

def test_fuzzy_match_rejects_meaning_inversion():
    # High char similarity, but a swapped content word must stay below threshold
    score = MeetingWorkflowEngine._fuzzy_match_score(
        "we agreed to delete production",
        "We agreed to keep production online.",
    )
    assert score < 0.85

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

def test_generate_summary_node_preserves_followup_fields(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm

    mock_response = MagicMock()
    mock_response.content = json.dumps({
        "metadata": {"title": "Planning", "date": "", "tags": []},
        "tldr": "Planning done.",
        "participants": [],
        "metrics": [],
        "key_decisions": [],
        "action_items": [],
        "summary_points": [],
        "risks": ["Vendor contract may slip."],
        "open_questions": ["Who owns the migration?"],
        "unresolved_topics": ["Budget for Q3"]
    })
    mock_llm.invoke.return_value = mock_response

    state = {
        "entities": {"numbers": [], "speakers": []},
        "decisions": [],
        "actions": []
    }

    res = engine.generate_summary_node(state)
    assert res["structured_summary"]["risks"] == ["Vendor contract may slip."]
    assert res["structured_summary"]["open_questions"] == ["Who owns the migration?"]
    assert res["structured_summary"]["unresolved_topics"] == ["Budget for Q3"]

def test_generate_summary_node_uses_native_structured_output(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm

    structured_llm = MagicMock()
    structured_llm.invoke.return_value = StructuredMeetingSummary(
        tldr="Structured path works.",
        summary_points=["Point one"],
        risks=["Vendor risk"],
    )
    mock_llm.with_structured_output.return_value = structured_llm

    state = {
        "entities": {"numbers": [], "speakers": []},
        "decisions": [],
        "actions": []
    }

    res = engine.generate_summary_node(state)
    assert res["structured_summary"]["tldr"] == "Structured path works."
    assert res["structured_summary"]["risks"] == ["Vendor risk"]
    # Native structured output means no raw invoke and no repair call
    mock_llm.invoke.assert_not_called()

def test_extract_action_items_structured_path_normalizes_enums(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm

    structured_llm = MagicMock()
    structured_llm.invoke.return_value = ClaimExtraction(
        decisions=[],
        actions=[ActionCandidate(
            task="Update the checklist",
            assignee="Bob",
            priority="high",
            status="OPEN",
            evidence_segment_ids=["seg_000000"],
            evidence_quote="Bob will update the checklist",
            confidence=0.9,
        )],
    )
    mock_llm.with_structured_output.return_value = structured_llm

    state = {"raw_transcript": "Bob will update the checklist"}
    res = engine.extract_action_items_node(state)

    assert len(res["actions"]) == 1
    assert res["actions"][0]["priority"] == "High"
    assert res["actions"][0]["status"] == "open"
    mock_llm.invoke.assert_not_called()

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


def _make_segments(count, speaker_ids=("SPEAKER_00", "SPEAKER_01"), text="Some spoken words here.", ms_per_segment=5000):
    return [
        {
            "segment_id": f"seg_{index:06d}",
            "speaker_id": speaker_ids[index % len(speaker_ids)] if speaker_ids else None,
            "speaker_name": None,
            "start_ms": index * ms_per_segment,
            "end_ms": (index + 1) * ms_per_segment,
            "text": text,
            "confidence": None,
            "words": [],
        }
        for index in range(count)
    ]


def test_finalize_chapters_derives_timestamps():
    segments = _make_segments(6)
    candidates = [
        {"title": "Closing", "start_segment_id": "seg_000004", "summary": "Wrap up."},
        {"title": "Opening", "start_segment_id": "seg_000002", "summary": "Kickoff."},
    ]

    chapters = MeetingWorkflowEngine._finalize_chapters(candidates, segments)

    assert len(chapters) == 2
    # Sorted chronologically, and the first chapter is forced to the first segment
    assert chapters[0]["title"] == "Opening"
    assert chapters[0]["start_segment_id"] == "seg_000000"
    assert chapters[0]["start_ms"] == 0
    # First chapter ends right before the next one starts
    assert chapters[0]["end_ms"] == segments[3]["end_ms"]
    # Last chapter runs to the end of the meeting
    assert chapters[1]["start_ms"] == segments[4]["start_ms"]
    assert chapters[1]["end_ms"] == segments[5]["end_ms"]


def test_finalize_chapters_drops_invalid_and_duplicate_ids():
    segments = _make_segments(4)
    candidates = [
        {"title": "Real", "start_segment_id": "seg_000000", "summary": ""},
        {"title": "Hallucinated", "start_segment_id": "seg_999999", "summary": ""},
        {"title": "Duplicate", "start_segment_id": "seg_000000", "summary": ""},
        {"title": "", "start_segment_id": "seg_000002", "summary": "no title"},
    ]

    chapters = MeetingWorkflowEngine._finalize_chapters(candidates, segments)

    assert [chapter["title"] for chapter in chapters] == ["Real"]
    assert MeetingWorkflowEngine._finalize_chapters([], segments) == []
    assert MeetingWorkflowEngine._finalize_chapters(candidates, []) == []


def test_segment_topics_node_uses_native_structured_output(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm

    structured_llm = MagicMock()
    structured_llm.invoke.return_value = ChapterExtraction(chapters=[
        ChapterCandidate(title="Kickoff", start_segment_id="seg_000000", summary="Intro."),
        ChapterCandidate(title="Budget", start_segment_id="seg_000003", summary="Numbers."),
    ])
    mock_llm.with_structured_output.return_value = structured_llm

    state = {"transcript_segments": _make_segments(6)}
    res = engine.segment_topics_node(state)

    assert [chapter["title"] for chapter in res["chapters"]] == ["Kickoff", "Budget"]
    assert res["chapters"][0]["start_ms"] == 0
    assert res["chapters"][1]["end_ms"] == 6 * 5000
    mock_llm.invoke.assert_not_called()


def test_segment_topics_node_fallback_raw_parse(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm

    mock_response = MagicMock()
    mock_response.content = json.dumps({
        "chapters": [{"title": "Kickoff", "start_segment_id": "seg_000000", "summary": "Intro."}]
    })
    mock_llm.invoke.return_value = mock_response

    state = {"transcript_segments": _make_segments(5)}
    res = engine.segment_topics_node(state)

    assert len(res["chapters"]) == 1
    assert res["chapters"][0]["title"] == "Kickoff"


def test_segment_topics_node_skips_short_meetings(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm

    res = engine.segment_topics_node({"transcript_segments": _make_segments(3)})

    assert res["chapters"] == []
    mock_llm.invoke.assert_not_called()
    mock_llm.with_structured_output.assert_not_called()


def test_compute_participation_normal_case():
    # SPEAKER_00 takes segments 0, 2 (10s); SPEAKER_01 takes segment 1 (5s)
    segments = _make_segments(3, text="one two three four")

    stats = MeetingWorkflowEngine._compute_participation(segments)

    assert [entry["speaker_id"] for entry in stats] == ["SPEAKER_00", "SPEAKER_01"]
    assert stats[0]["turns"] == 2
    assert stats[0]["talk_time_ms"] == 10000
    assert stats[0]["word_count"] == 8
    assert stats[0]["percentage"] == 66.7
    assert stats[1]["percentage"] == 33.3


def test_compute_participation_degrades_to_word_count_without_timestamps():
    segments = _make_segments(2, ms_per_segment=0)
    segments[0]["text"] = "one two three"
    segments[1]["text"] = "one"

    stats = MeetingWorkflowEngine._compute_participation(segments)

    assert stats[0]["talk_time_ms"] == 0
    assert stats[0]["percentage"] == 75.0
    assert stats[1]["percentage"] == 25.0


def test_compute_participation_without_speakers_returns_empty():
    segments = _make_segments(3, speaker_ids=())
    assert MeetingWorkflowEngine._compute_participation(segments) == []


def test_map_reduce_path_includes_chapters_and_participation(mock_llm, monkeypatch):
    # Regression guard for the duplicated short/long paths in run(): a node wired
    # only into the LangGraph would silently never run for long meetings.
    monkeypatch.setattr(MeetingWorkflowEngine, "_initialize_llm", lambda self: mock_llm)
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")

    mock_response = MagicMock()
    mock_response.content = json.dumps({
        "speakers": [], "numbers": [], "dates": [], "projects": [], "acronyms": [],
        "decisions": [], "actions": [],
        "chapters": [{"title": "Opening", "start_segment_id": "seg_000000", "summary": "Intro."}],
        "metadata": {"title": "Long meeting", "date": "", "tags": []},
        "tldr": "Long meeting summary.",
        "participants": [], "metrics": [], "summary_points": [],
    })
    mock_llm.invoke.return_value = mock_response

    # 40 segments x ~1000 chars ≈ 40k chars > threshold (16384 * 0.6 * 3.5 ≈ 34.4k)
    segments = _make_segments(40, text="word " * 200)
    transcript = "\n".join(segment["text"] for segment in segments)

    res = engine.run(transcript, transcript_segments=segments)

    chapters = res["structured"]["chapters"]
    assert len(chapters) == 1
    assert chapters[0]["title"] == "Opening"
    assert chapters[0]["start_ms"] == 0
    assert chapters[0]["end_ms"] == segments[-1]["end_ms"]
    assert res["structured"]["participation"], "participation must be computed on the long path"


def test_generate_followup_email_structured_path(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm

    structured_llm = MagicMock()
    structured_llm.invoke.return_value = FollowUpEmail(
        subject="Follow-up: Q3 Planning",
        body="Hi all, summary of what we agreed...",
    )
    mock_llm.with_structured_output.return_value = structured_llm

    email = engine.generate_followup_email({
        "tldr": "We planned Q3.",
        "metadata": {"title": "Q3 Planning"},
        "key_decisions": [], "action_items": [],
    })

    assert email["subject"] == "Follow-up: Q3 Planning"
    assert email["body"].startswith("Hi all")
    mock_llm.invoke.assert_not_called()


def test_generate_followup_email_fallback_uses_raw_body(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm

    mock_response = MagicMock()
    mock_response.content = "Hi team, here is the follow-up of our meeting."
    mock_llm.invoke.return_value = mock_response

    email = engine.generate_followup_email({
        "tldr": "Summary.",
        "metadata": {"title": "Weekly Sync"},
    })

    assert email["subject"] == "Follow-up: Weekly Sync"
    assert email["body"] == "Hi team, here is the follow-up of our meeting."


def _previous_meeting(meeting_id, date, actions=(), tags=(), questions=()):
    return {
        "meeting_id": meeting_id,
        "title": f"Meeting {meeting_id}",
        "date": date,
        "summary": {
            "metadata": {"tags": list(tags)},
            "action_items": [{"task": task, "status": "open"} for task in actions],
            "open_questions": list(questions),
        },
    }


def test_find_recurring_open_actions_matches_fuzzy():
    current = [{"task": "Enviar relatório de vendas", "status": "open"}]
    previous = [
        _previous_meeting(1, "2026-07-01 10:00:00", actions=["enviar o relatório de vendas mensal"]),
        _previous_meeting(2, "2026-07-05 10:00:00", actions=["Enviar relatório de vendas"]),
    ]

    recurring = find_recurring_open_actions(current, previous)

    assert len(recurring) == 1
    assert recurring[0]["occurrences"] == 3  # current + 2 previous
    assert recurring[0]["first_seen_meeting_id"] == 1  # oldest date wins
    assert set(recurring[0]["matched_meeting_ids"]) == {1, 2}


def test_find_recurring_open_actions_ignores_completed_and_dissimilar():
    current = [
        {"task": "Enviar relatório de vendas", "status": "completed"},
        {"task": "Comprar café para o escritório", "status": "open"},
    ]
    previous = [
        _previous_meeting(1, "2026-07-01 10:00:00", actions=["Enviar relatório de vendas"]),
        {"meeting_id": 2, "date": "2026-07-02 10:00:00", "summary": {}},  # sem action_items
        {"meeting_id": None, "summary": {"action_items": [{"task": "Comprar café"}]}},  # sem id
        "malformed",
    ]

    assert find_recurring_open_actions(current, previous) == []


def test_find_recurring_topics_tags_and_fuzzy_questions():
    current = {
        "metadata": {"tags": ["Orçamento", "produto"]},
        "open_questions": ["Quem vai conduzir as entrevistas técnicas?"],
        "unresolved_topics": [],
    }
    previous = [
        _previous_meeting(
            1, "2026-07-01 10:00:00",
            tags=["orçamento"],
            questions=["quem conduzirá as entrevistas técnicas?"],
        ),
    ]

    recurring = find_recurring_topics(current, previous)

    assert "Orçamento" in recurring  # tag: match exato case-insensitive
    assert any("entrevistas" in topic for topic in recurring)  # pergunta: fuzzy
    assert "produto" not in recurring


def test_rank_previous_meetings_by_score_then_recency():
    previous = [
        {"meeting_id": 1, "date": "2026-07-01 10:00:00"},
        {"meeting_id": 2, "date": "2026-07-05 10:00:00"},
        {"meeting_id": 3, "date": "2026-07-06 10:00:00"},
        {"meeting_id": 4, "date": "2026-07-07 10:00:00"},
        {"meeting_id": 99, "date": "2026-07-08 10:00:00"},  # reunião atual
    ]
    rag_results = [
        {"meeting_id": 1, "score": 0.4},
        {"meeting_id": 1, "score": 0.3},   # soma: 0.7
        {"meeting_id": 2, "score": 0.5},
        {"meeting_id": 99, "score": 0.9},  # atual: ignorada
    ]

    ranked = rank_previous_meetings(previous, rag_results, current_meeting_id=99, limit=3)

    assert [meeting["meeting_id"] for meeting in ranked] == [1, 2, 4]
    assert ranked[0]["via"] == "rag"
    assert ranked[1]["via"] == "rag"
    assert ranked[2]["via"] == "recency"  # completa por recência (4 > 3)


def test_rank_previous_meetings_recency_fallback_without_rag():
    previous = [
        {"meeting_id": 1, "date": "2026-07-01 10:00:00"},
        {"meeting_id": 2, "date": "2026-07-05 10:00:00"},
    ]

    ranked = rank_previous_meetings(previous, [], current_meeting_id=99)

    assert [meeting["meeting_id"] for meeting in ranked] == [2, 1]
    assert all(meeting["via"] == "recency" for meeting in ranked)


def test_generate_continuity_report_structured_path(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm

    structured_llm = MagicMock()
    structured_llm.invoke.return_value = ContinuityAnalysis(
        reverted_or_changed_decisions=[ChangedDecision(
            current="Voltar para SQLite",
            previous="Usar Postgres",
            previous_meeting_id=1,
        )],
        recurring_open_actions=[RecurringAction(task="Atualizar a documentação", occurrences=2)],
        recurring_topics=["migração"],
        summary="A decisão do banco foi revertida.",
    )
    mock_llm.with_structured_output.return_value = structured_llm

    related = [
        {"meeting_id": 1, "title": "Sprint 1", "date": "2026-07-01 10:00:00", "via": "rag",
         "summary": {"tldr": "Decidimos usar Postgres."}},
    ]
    report = engine.generate_continuity_report({"tldr": "Voltamos para SQLite."}, related)

    # related_meetings vem da seleção determinística, nunca do LLM
    assert report["related_meetings"] == [
        {"meeting_id": 1, "title": "Sprint 1", "date": "2026-07-01 10:00:00", "reason": "similar content"}
    ]
    assert report["reverted_or_changed_decisions"][0]["previous_meeting_id"] == 1
    assert report["summary"] == "A decisão do banco foi revertida."
    mock_llm.invoke.assert_not_called()


def test_generate_continuity_report_sanitizes_hallucinated_ids(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm

    structured_llm = MagicMock()
    structured_llm.invoke.return_value = ContinuityAnalysis(
        reverted_or_changed_decisions=[ChangedDecision(current="X", previous_meeting_id=999)],
        recurring_open_actions=[RecurringAction(task="Y", first_seen_meeting_id=42)],
        summary="ok",
    )
    mock_llm.with_structured_output.return_value = structured_llm

    related = [{"meeting_id": 1, "title": "M1", "date": "2026-07-01", "via": "recency", "summary": {}}]
    report = engine.generate_continuity_report({}, related)

    assert report["reverted_or_changed_decisions"][0]["previous_meeting_id"] is None
    assert report["recurring_open_actions"][0]["first_seen_meeting_id"] is None


def test_generate_continuity_report_fallback_uses_deterministic_hints(mock_llm):
    engine = MeetingWorkflowEngine(provider_name="ollama", model_name="llama3")
    engine.llm = mock_llm

    # structured output e parse do texto bruto falham
    mock_response = MagicMock()
    mock_response.content = "not json at all"
    mock_llm.invoke.return_value = mock_response

    current = {
        "action_items": [{"task": "Atualizar a documentação do projeto", "status": "open"}],
        "metadata": {"tags": ["docs"]},
    }
    related = [
        {"meeting_id": 1, "title": "M1", "date": "2026-07-01", "via": "recency",
         "summary": {
             "metadata": {"tags": ["docs"]},
             "action_items": [{"task": "atualizar a documentação do projeto", "status": "open"}],
         }},
    ]
    report = engine.generate_continuity_report(current, related)

    assert report["recurring_open_actions"][0]["task"] == "Atualizar a documentação do projeto"
    assert report["recurring_open_actions"][0]["occurrences"] == 2
    assert report["recurring_topics"] == ["docs"]
    assert report["reverted_or_changed_decisions"] == []
    assert report["related_meetings"][0]["reason"] == "recent meeting"
