import numpy as np
from unittest.mock import MagicMock, patch
from vad_service import VADService

def test_vad_service_initialization_success():
    mock_model = MagicMock()
    mock_get_speech = MagicMock()
    
    with patch("torch.hub.load", return_value=(mock_model, [mock_get_speech])) as mock_hub:
        service = VADService()
        assert service.model == mock_model
        assert service.get_speech_timestamps == mock_get_speech
        mock_hub.assert_called_once()

def test_vad_service_initialization_failure():
    with patch("torch.hub.load", side_effect=Exception("Connection timed out")):
        service = VADService()
        assert service.model is None

def test_trim_silence_no_model():
    with patch("torch.hub.load", side_effect=Exception("Error")):
        service = VADService()
        # Should return original data if no model
        dummy_audio = np.array([1, 2, 3])
        res = service.trim_silence(dummy_audio, 16000)
        assert np.array_equal(res, dummy_audio)

def test_trim_silence_empty_input():
    mock_model = MagicMock()
    mock_get_speech = MagicMock()
    
    with patch("torch.hub.load", return_value=(mock_model, [mock_get_speech])):
        service = VADService()
        empty_audio = np.array([])
        res = service.trim_silence(empty_audio, 16000)
        assert res.size == 0

def test_trim_silence_pure_silence():
    mock_model = MagicMock()
    mock_get_speech = MagicMock(return_value=[]) # no speech segments
    
    with patch("torch.hub.load", return_value=(mock_model, [mock_get_speech])):
        service = VADService()
        
        # Audio filled with zeros
        silent_audio = np.zeros(16000, dtype=np.int16)
        res = service.trim_silence(silent_audio, 16000)
        
        assert res.size == 0
        mock_get_speech.assert_called_once()

def test_trim_silence_pure_speech():
    mock_model = MagicMock()
    # Mocking get_speech_timestamps to return a single continuous segment
    mock_get_speech = MagicMock(return_value=[{'start': 0, 'end': 16000}])
    
    with patch("torch.hub.load", return_value=(mock_model, [mock_get_speech])):
        service = VADService()
        
        speech_audio = np.ones(16000, dtype=np.int16) * 1000
        res = service.trim_silence(speech_audio, 16000)
        
        # Should return all the speech segment
        assert res.size == 16000
        assert np.all(res == 1000)

def test_trim_silence_mixed_speech_and_decimation():
    mock_model = MagicMock()
    # Mocking get_speech_timestamps to return only speech regions (e.g., from 4000 to 12000 in 16k context)
    mock_get_speech = MagicMock(return_value=[{'start': 4000, 'end': 12000}])
    
    with patch("torch.hub.load", return_value=(mock_model, [mock_get_speech])):
        service = VADService()
        
        # Feed high rate audio (e.g. 48000Hz), so scale is 3
        # Size is 48000 (1 second). Speech starts at 4000*3=12000 and ends at 12000*3=36000
        mixed_audio = np.arange(48000, dtype=np.int32)
        res = service.trim_silence(mixed_audio, 48000)
        
        # Decimated size should be (12000 - 4000) * 3 = 24000
        assert res.size == 24000
        assert res[0] == 12000
        assert res[-1] == 35999

def test_trim_silence_exception_fallback():
    mock_model = MagicMock()
    # Simulates an exception inside silero VAD call
    mock_get_speech = MagicMock(side_effect=RuntimeError("PyTorch device crash"))
    
    with patch("torch.hub.load", return_value=(mock_model, [mock_get_speech])):
        service = VADService()
        
        dummy_audio = np.array([10, 20, 30], dtype=np.int16)
        res = service.trim_silence(dummy_audio, 16000)
        
        # Falls back cleanly to raw audio
        assert np.array_equal(res, dummy_audio)
