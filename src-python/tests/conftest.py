import pytest
from unittest.mock import MagicMock

@pytest.fixture
def mock_llm():
    """Provides a mocked chat model invoke method returning predictable contents."""
    mock = MagicMock()
    # By default, invoke returns a generic mock response
    mock_response = MagicMock()
    mock_response.content = "{}"
    mock.invoke.return_value = mock_response
    return mock

@pytest.fixture
def sample_transcript_en():
    return (
        "Alice: Welcome everyone. Today we are launching the new database.\n"
        "Bob: That is great! I will finalize the schema by tomorrow."
    )

@pytest.fixture
def sample_transcript_pt():
    return (
        "Carlos: Olá a todos. A reunião começou.\n"
        "Ana: Excelente! Eu vou configurar os servidores hoje à tarde."
    )

@pytest.fixture
def sample_transcript_mixed():
    return (
        "Carlos: Olá a todos.\n"
        "Bob: Hello Carlos, did you complete the schema?\n"
        "Carlos: Sim, está pronto."
    )
