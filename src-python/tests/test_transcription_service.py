import pytest
import os
from unittest.mock import MagicMock, patch
from transcription_service import TranscriptionService

def test_transcription_service_hardware_detection_cuda():
    # Mocking cuda to be available
    with patch("torch.cuda.is_available", return_value=True), \
         patch("whisperx.load_model") as mock_load_model:
        
        service = TranscriptionService()
        assert service.device == "cuda"
        assert service.compute_type == "float16"
        mock_load_model.assert_called_with("base", "cuda", compute_type="float16")

def test_transcription_service_hardware_detection_mps():
    # Mocking cuda unavailable, mps available
    with patch("torch.cuda.is_available", return_value=False), \
         patch("torch.backends.mps.is_available", return_value=True), \
         patch("whisperx.load_model") as mock_load_model:
        
        service = TranscriptionService()
        assert service.device == "mps"
        assert service.compute_type == "float16"
        mock_load_model.assert_called_with("base", "mps", compute_type="float16")

def test_transcription_service_hardware_detection_cpu_fallback():
    # Mocking cuda/mps unavailable, testing standard cpu path
    with patch("torch.cuda.is_available", return_value=False), \
         patch("torch.backends.mps.is_available", return_value=False), \
         patch("whisperx.load_model") as mock_load_model:
        
        service = TranscriptionService()
        assert service.device == "cpu"
        assert service.compute_type == "int8"
        mock_load_model.assert_called_with("base", "cpu", compute_type="int8")

def test_transcription_service_gpu_failure_cpu_fallback():
    # GPU is available but loading model fails, causing CPU fallback
    with patch("torch.cuda.is_available", return_value=True), \
         patch("whisperx.load_model") as mock_load_model:
        
        # Raise error on cuda loading, succeed on cpu
        def side_effect(model_name, device, compute_type):
            if device == "cuda":
                raise RuntimeError("CUDA out of memory")
            return MagicMock()
            
        mock_load_model.side_effect = side_effect
        
        service = TranscriptionService()
        assert service.device == "cpu"
        assert service.compute_type == "int8"

def test_transcribe_missing_or_empty_file():
    with patch("torch.cuda.is_available", return_value=False), \
         patch("whisperx.load_model"):
        
        service = TranscriptionService()
        
        # Test missing file
        res = service.transcribe("nonexistent.wav")
        assert "not found" in res["text"]
        assert res["segments"] is None
        
        # Test empty file
        with patch("os.path.exists", return_value=True), \
             patch("os.path.getsize", return_value=10): # size too small
            res = service.transcribe("empty.wav")
            assert "empty" in res["text"]

def test_transcribe_plain_success():
    with patch("torch.cuda.is_available", return_value=False), \
         patch("whisperx.load_model") as mock_load_model:
        
        mock_model = MagicMock()
        mock_model.transcribe.return_value = {"segments": [{"text": "Hello world"}]}
        mock_load_model.return_value = mock_model
        
        service = TranscriptionService()
        
        with patch("os.path.exists", return_value=True), \
             patch("os.path.getsize", return_value=5000), \
             patch("whisperx.load_audio"), \
             patch("whisperx.load_align_model"), \
             patch("whisperx.align", return_value={"segments": [{"text": "Hello world"}]}):
            
            res = service.transcribe("sample.wav")
            assert res["text"] == "Hello world"
            assert res["segments"] is None
            assert res["diarized"] is False

def test_transcribe_diarization_without_token():
    with patch("torch.cuda.is_available", return_value=False), \
         patch("whisperx.load_model") as mock_load_model:
        
        mock_model = MagicMock()
        mock_model.transcribe.return_value = {"segments": [{"text": "Hello"}]}
        mock_load_model.return_value = mock_model
        
        service = TranscriptionService()
        
        with patch("os.path.exists", return_value=True), \
             patch("os.path.getsize", return_value=5000), \
             patch("whisperx.load_audio"), \
             patch("whisperx.load_align_model"), \
             patch("whisperx.align", return_value={"segments": [{"text": "Hello"}]}):
            
            # request diarization but supply no token
            res = service.transcribe("sample.wav", speaker_diarization=True, hf_token=None)
            assert res["text"] == "Hello"
            assert res["segments"] is None
            assert res["diarized"] is False

def test_transcribe_diarization_success():
    with patch("torch.cuda.is_available", return_value=False), \
         patch("whisperx.load_model") as mock_load_model:
        
        mock_model = MagicMock()
        mock_model.transcribe.return_value = {"segments": [{"text": "Hello"}]}
        mock_load_model.return_value = mock_model
        
        service = TranscriptionService()
        
        with patch("os.path.exists", return_value=True), \
             patch("os.path.getsize", return_value=5000), \
             patch("whisperx.load_audio"), \
             patch("whisperx.load_align_model"), \
             patch("whisperx.align", return_value={"segments": [{"text": "Hello"}]}), \
             patch("whisperx.DiarizationPipeline", create=True) as mock_pipeline, \
             patch("whisperx.assign_word_speakers") as mock_assign:
             
            mock_assign.return_value = {"segments": [{"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0, "text": "Hello"}]}
            
            res = service.transcribe("sample.wav", speaker_diarization=True, hf_token="valid_token")
            assert res["text"] == "Hello"
            assert res["segments"] == [{"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0, "text": "Hello"}]
            assert res["diarized"] is True
