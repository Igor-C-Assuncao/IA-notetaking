# SPDX-License-Identifier: Apache-2.0
import json

import main


def test_sanitize_diagnostic_message_redacts_credentials_and_content():
    message = main.sanitize_diagnostic_message(
        "api_key=secret token:abc raw_transcript=private prompt=confidential"
    )
    assert "secret" not in message
    assert "private" not in message
    assert "confidential" not in message
    assert message.count("[REDACTED]") == 4


def test_engine_state_emits_public_runtime_and_sanitized_diagnostic(monkeypatch):
    events = []
    monkeypatch.setattr(main, "send_event", lambda event, data: events.append((event, data)))

    main.emit_engine_state(
        "transcription_ready",
        recording=True,
        transcription=True,
        message="Transcription is ready.",
    )

    assert [event for event, _ in events] == [
        "ENGINE_STATE",
        "AI_RUNTIME_STATUS",
        "DIAGNOSTIC_EVENT",
    ]
    assert events[1][1]["state"] == "ready"


def test_ollama_runtime_status_reads_tags_and_active_models(monkeypatch):
    class Response:
        def __init__(self, payload):
            self.payload = payload

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return json.dumps(self.payload).encode()

    def fake_urlopen(url, timeout):
        assert timeout == 2.0
        if str(url).endswith("/api/tags"):
            return Response({"models": [{"name": "llama3:latest"}]})
        return Response({"models": [{"name": "llama3:latest"}]})

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    status = main.ollama_runtime_status()

    assert status == {
        "state": "loading_model",
        "models": ["llama3:latest"],
        "active_models": ["llama3:latest"],
    }


def test_ollama_runtime_status_is_offline_on_timeout(monkeypatch):
    monkeypatch.setattr("urllib.request.urlopen", lambda *_args, **_kwargs: (_ for _ in ()).throw(TimeoutError()))
    assert main.ollama_runtime_status()["state"] == "offline"
