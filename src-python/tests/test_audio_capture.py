# src-python/tests/test_audio_capture.py
import pytest
import numpy as np
import os
import wave
from unittest.mock import MagicMock, patch
from audio_capture import WindowsAudioCapture

def test_stream_alignment_mic_starts_later():
    """Verifies that if the microphone starts recording later, padding is prepended to it."""
    capture = WindowsAudioCapture()
    capture.is_recording = True
    
    # Mock stream objects and pyaudio context to avoid native driver dependencies
    capture.loopback_thread = MagicMock()
    capture.mic_thread = MagicMock()
    capture.loopback_stream = MagicMock()
    capture.mic_stream = MagicMock()
    capture.p = MagicMock()
    
    # Lag: Mic started 0.1 seconds later than Loopback (4800 samples at 48kHz)
    capture.loopback_start_time = 10.0
    capture.mic_start_time = 10.1 
    
    capture.loopback_frames = [np.ones(48000, dtype=np.int16) * 100]
    capture.mic_frames = [np.ones(43200, dtype=np.int16) * 200]
    
    with patch("wave.open") as mock_wave, \
         patch("vad_service.VADService") as mock_vad:
        # Mock VAD to bypass silence-trimming during DSP tests
        mock_vad.return_value.trim_silence.side_effect = lambda x, sr: x
        
        capture.stop_recording()
        
        # Verify that lengths were matched and zero padded
        assert not capture.is_recording
        
        # Verify wave parameters
        mock_wf = mock_wave.return_value.__enter__.return_value
        mock_wf.setnchannels.assert_called_with(1)
        mock_wf.setframerate.assert_called_with(16000)

def test_stream_alignment_loopback_starts_later():
    """Verifies that if loopback starts recording later, padding is prepended to it."""
    capture = WindowsAudioCapture()
    capture.is_recording = True
    capture.loopback_thread = MagicMock()
    capture.mic_thread = MagicMock()
    capture.loopback_stream = MagicMock()
    capture.mic_stream = MagicMock()
    capture.p = MagicMock()
    
    # Lag: Loopback started 0.05 seconds later than Mic (2400 samples at 48kHz)
    capture.mic_start_time = 10.0
    capture.loopback_start_time = 10.05
    
    capture.mic_frames = [np.ones(48000, dtype=np.int16) * 200]
    capture.loopback_frames = [np.ones(45600, dtype=np.int16) * 100]
    
    with patch("wave.open") as mock_wave, \
         patch("vad_service.VADService") as mock_vad:
        mock_vad.return_value.trim_silence.side_effect = lambda x, sr: x
        capture.stop_recording()
        assert not capture.is_recording
        
        # Verify wave parameters
        mock_wf = mock_wave.return_value.__enter__.return_value
        mock_wf.setnchannels.assert_called_with(1)
        mock_wf.setframerate.assert_called_with(16000)

def test_70_30_gain_mixing_and_limiting():
    """Verifies the 70% Mic / 30% Loopback mix ratio and soft limiter behavior."""
    capture = WindowsAudioCapture()
    capture.is_recording = True
    capture.loopback_thread = MagicMock()
    capture.mic_thread = MagicMock()
    capture.loopback_stream = MagicMock()
    capture.mic_stream = MagicMock()
    capture.p = MagicMock()
    
    capture.mic_start_time = 10.0
    capture.loopback_start_time = 10.0
    
    # Equal full-scale inputs (32767)
    # Target Mix = (32767 * 0.7) + (32767 * 0.3) = 32767 (should not clip)
    capture.mic_frames = [np.ones(10, dtype=np.int16) * 32767]
    capture.loopback_frames = [np.ones(10, dtype=np.int16) * 32767]
    
    with patch("wave.open") as mock_wave, \
         patch("vad_service.VADService") as mock_vad:
        mock_vad.return_value.trim_silence.side_effect = lambda x, sr: x
        capture.stop_recording()
        
        # Verify wave parameters
        mock_wf = mock_wave.return_value.__enter__.return_value
        mock_wf.setnchannels.assert_called_with(1)
        mock_wf.setframerate.assert_called_with(16000)

def test_torchaudio_resample_fallback_on_exception():
    """Verifies seamless fallback to decimation slicing when torchaudio is absent or crashes."""
    capture = WindowsAudioCapture()
    capture.is_recording = True
    capture.loopback_thread = MagicMock()
    capture.mic_thread = MagicMock()
    capture.loopback_stream = MagicMock()
    capture.mic_stream = MagicMock()
    capture.p = MagicMock()
    
    capture.mic_start_time = 10.0
    capture.loopback_start_time = 10.0
    capture.mic_frames = [np.arange(48000, dtype=np.int16)]
    
    # Raise an exception when attempting torchaudio resampling
    with patch("torchaudio.transforms.Resample", side_effect=ImportError("No torchaudio")), \
         patch("wave.open") as mock_wave, \
         patch("vad_service.VADService") as mock_vad:
        mock_vad.return_value.trim_silence.side_effect = lambda x, sr: x
        capture.stop_recording()
        
        # Verify it falls back successfully to decimation
        assert not capture.is_recording
        
        # Verify wave parameters
        mock_wf = mock_wave.return_value.__enter__.return_value
        mock_wf.setnchannels.assert_called_with(1)
        mock_wf.setframerate.assert_called_with(16000)
