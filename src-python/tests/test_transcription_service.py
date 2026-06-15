from unittest.mock import MagicMock, patch
from transcription_service import TranscriptionService

def test_transcription_service_hardware_detection_cuda():
    # Mocking cuda to be available
    with patch("torch.cuda.is_available", return_value=True), \
         patch("whisperx.load_model") as mock_load_model:
        
        service = TranscriptionService()
        assert service.device == "cuda"
        assert service.compute_type == "float16"
        mock_load_model.assert_called_with(
            "base", "cuda", compute_type="float16", download_root=None
        )

def test_transcription_service_hardware_detection_mps():
    # Mocking cuda unavailable, mps available
    with patch("torch.cuda.is_available", return_value=False), \
         patch("torch.backends.mps.is_available", return_value=True), \
         patch("whisperx.load_model") as mock_load_model:
        
        service = TranscriptionService()
        assert service.device == "mps"
        assert service.compute_type == "float16"
        mock_load_model.assert_called_with(
            "base", "mps", compute_type="float16", download_root=None
        )

def test_transcription_service_hardware_detection_cpu_fallback():
    # Mocking cuda/mps unavailable, testing standard cpu path
    with patch("torch.cuda.is_available", return_value=False), \
         patch("torch.backends.mps.is_available", return_value=False), \
         patch("whisperx.load_model") as mock_load_model:
        
        service = TranscriptionService()
        assert service.device == "cpu"
        assert service.compute_type == "int8"
        mock_load_model.assert_called_with(
            "base", "cpu", compute_type="int8", download_root=None
        )

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
        assert res["ok"] is False
        assert res["text"] == ""
        assert res["error"]["code"] == "AUDIO_FILE_NOT_FOUND"
        assert "not found" in res["error"]["message"]
        assert res["segments"] is None
        
        # Test empty file
        with patch("os.path.exists", return_value=True), \
             patch("os.path.getsize", return_value=10): # size too small
            res = service.transcribe("empty.wav")
            assert res["ok"] is False
            assert res["error"]["code"] == "AUDIO_FILE_EMPTY"
            assert "empty" in res["error"]["message"]

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
             patch("whisperx.load_align_model", return_value=(MagicMock(), {})), \
             patch("whisperx.align", return_value={"segments": [{"start": 0.0, "end": 1.2, "text": "Hello world"}]}):
            
            res = service.transcribe("sample.wav")
            assert res["ok"] is True
            assert res["text"] == "Hello world"
            assert res["segments"] == [{
                "segment_id": "seg_000000",
                "speaker_id": None,
                "speaker_name": None,
                "start_ms": 0,
                "end_ms": 1200,
                "text": "Hello world",
                "confidence": None,
                "words": [],
            }]
            assert res["diarized"] is False
            assert res["error"] is None

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
             patch("whisperx.load_align_model", return_value=(MagicMock(), {})), \
             patch("whisperx.align", return_value={"segments": [{"start": 0.0, "end": 1.0, "text": "Hello"}]}):
            
            # request diarization but supply no token
            res = service.transcribe("sample.wav", speaker_diarization=True, hf_token=None)
            assert res["ok"] is True
            assert res["text"] == "Hello"
            assert res["segments"][0]["segment_id"] == "seg_000000"
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
             patch("whisperx.load_align_model", return_value=(MagicMock(), {})), \
             patch("whisperx.align", return_value={"segments": [{"start": 0.0, "end": 1.0, "text": "Hello"}]}), \
             patch("whisperx.DiarizationPipeline", create=True), \
             patch("whisperx.assign_word_speakers") as mock_assign:
             
            mock_assign.return_value = {"segments": [{"speaker": "SPEAKER_00", "start": 0.0, "end": 1.0, "text": "Hello"}]}
            
            res = service.transcribe("sample.wav", speaker_diarization=True, hf_token="valid_token")
            assert res["ok"] is True
            assert res["text"] == "Hello"
            assert res["segments"][0] == {
                "segment_id": "seg_000000",
                "speaker_id": "SPEAKER_00",
                "speaker_name": None,
                "start_ms": 0,
                "end_ms": 1000,
                "text": "Hello",
                "confidence": None,
                "words": [],
            }
            assert res["diarized"] is True

def test_transcribe_runtime_failure_returns_structured_error():
    with patch("torch.cuda.is_available", return_value=False), \
         patch("whisperx.load_model") as mock_load_model:

        mock_model = MagicMock()
        mock_model.transcribe.side_effect = RuntimeError("decoder failed")
        mock_load_model.return_value = mock_model

        service = TranscriptionService()

        with patch("os.path.exists", return_value=True), \
             patch("os.path.getsize", return_value=5000), \
             patch("whisperx.load_audio"):
            res = service.transcribe("sample.wav")

        assert res == {
            "ok": False,
            "text": "",
            "segments": None,
            "diarized": False,
            "warnings": [],
            "error": {
                "code": "TRANSCRIPTION_FAILED",
                "message": "decoder failed",
            },
            "schema_version": 2,
        }
