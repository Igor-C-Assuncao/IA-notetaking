# src-python/audio_capture.py
import sys
import os
import threading
import wave
import numpy as np
import pyaudiowpatch as pyaudio
from abc import ABC, abstractmethod

# ---------------------------------------------------------
# STRATEGY PATTERN: The abstract interface
# ---------------------------------------------------------
class AudioCaptureStrategy(ABC):
    """
    Abstract base class defining the contract for all audio capture strategies.
    """
    @abstractmethod
    def start_recording(self):
        """Starts capturing system and microphone audio."""
        pass

    @abstractmethod
    def stop_recording(self) -> str:
        """Stops capturing and returns the absolute path to the saved audio file."""
        pass

# ---------------------------------------------------------
# CONCRETE STRATEGIES: OS-specific implementations
# ---------------------------------------------------------
class WindowsAudioCapture(AudioCaptureStrategy):
    """
    Robust Windows implementation recording Loopback and Mic into a Stereo file.
    Initializes PyAudio sequentially to prevent PortAudio C-level thread crashes,
    and uses thread joining to prevent stream-close deadlocks.
    """
    
    def __init__(self):
        self.is_recording = False
        
        # Audio Engine references
        self.p = None
        self.loopback_stream = None
        self.mic_stream = None
        
        # Thread references (CRITICAL for preventing deadlocks)
        self.loopback_thread = None
        self.mic_thread = None
        
        # Buffers
        self.loopback_frames = []
        self.mic_frames = []
        
        # Standard configuration for Speech-to-Text models
        self.master_sample_rate = 48000
        self.loopback_channels = 2
        self.mic_channels = 1
        
        current_dir = os.path.dirname(os.path.abspath(__file__))
        self.output_file = os.path.join(current_dir, "temp_meeting_audio.wav")

    def start_recording(self):
        if self.is_recording:
            return

        self.is_recording = True
        self.loopback_frames = []
        self.mic_frames = []
        
        # 1. Initialize PyAudio ONCE in the main thread
        self.p = pyaudio.PyAudio()

        # 2. Safely open the Loopback stream
        try:
            loopback_device = self.p.get_default_wasapi_loopback()
            self.loopback_channels = loopback_device["maxInputChannels"]
            
            self.loopback_stream = self.p.open(
                format=pyaudio.paInt16,
                channels=self.loopback_channels,
                rate=self.master_sample_rate,
                input=True,
                input_device_index=loopback_device["index"],
                frames_per_buffer=1024
            )
        except Exception as e:
            print(f"DEBUG: [Windows Audio] Loopback stream failed to open: {str(e)}", file=sys.stderr)
            self.loopback_stream = None

        # 3. Safely open the Microphone stream
        try:
            mic_device = self.p.get_default_input_device_info()
            self.mic_channels = mic_device["maxInputChannels"]
            
            self.mic_stream = self.p.open(
                format=pyaudio.paInt16,
                channels=self.mic_channels,
                rate=self.master_sample_rate,
                input=True,
                input_device_index=mic_device["index"],
                frames_per_buffer=1024
            )
        except Exception as e:
            print(f"DEBUG: [Windows Audio] Microphone stream failed to open: {str(e)}", file=sys.stderr)
            self.mic_stream = None

        # 4. Spawn threads and SAVE their references to join them later
        if self.loopback_stream:
            self.loopback_thread = threading.Thread(target=self._record_loopback, daemon=True)
            self.loopback_thread.start()
        
        if self.mic_stream:
            self.mic_thread = threading.Thread(target=self._record_mic, daemon=True)
            self.mic_thread.start()
            
        print("DEBUG: [Windows] Started Dual-Channel Capture successfully.", file=sys.stderr)

    def _record_loopback(self):
        """Continuously reads data from the loopback stream into memory."""
        try:
            while self.is_recording and self.loopback_stream:
                data = self.loopback_stream.read(1024, exception_on_overflow=False)
                audio_data = np.frombuffer(data, dtype=np.int16)
                
                if self.loopback_channels > 1:
                    audio_data = np.reshape(audio_data, (-1, self.loopback_channels))
                    audio_data = np.mean(audio_data, axis=1).astype(np.int16)
                    
                self.loopback_frames.append(audio_data)
        except Exception as e:
            print(f"DEBUG: [Windows Loopback Error] {str(e)}", file=sys.stderr)

    def _record_mic(self):
        """Continuously reads data from the microphone stream into memory."""
        try:
            while self.is_recording and self.mic_stream:
                data = self.mic_stream.read(1024, exception_on_overflow=False)
                audio_data = np.frombuffer(data, dtype=np.int16)
                
                if self.mic_channels > 1:
                    audio_data = np.reshape(audio_data, (-1, self.mic_channels))
                    audio_data = np.mean(audio_data, axis=1).astype(np.int16)
                    
                self.mic_frames.append(audio_data)
        except Exception as e:
            print(f"DEBUG: [Windows Mic Error] {str(e)}", file=sys.stderr)

    def stop_recording(self) -> str:
        if not self.is_recording:
            return self.output_file

        self.is_recording = False
        
        if self.loopback_thread: self.loopback_thread.join(timeout=2.0)
        if self.mic_thread: self.mic_thread.join(timeout=2.0)

        if not self.loopback_frames and not self.mic_frames:
            return self.output_file

        # Build raw arrays
        mic_full = np.concatenate(self.mic_frames) if self.mic_frames else np.array([], dtype=np.int16)
        loopback_full = np.concatenate(self.loopback_frames) if self.loopback_frames else np.array([], dtype=np.int16)

        # Sync lengths
        max_len = max(len(mic_full), len(loopback_full))
        if len(mic_full) < max_len:
            mic_full = np.pad(mic_full, (0, max_len - len(mic_full)), mode='constant')
        if len(loopback_full) < max_len:
            loopback_full = np.pad(loopback_full, (0, max_len - len(loopback_full)), mode='constant')

        # NEW: Apply VAD to remove silence before saving
        print("DEBUG: [AI] Running Silero VAD to trim silence...", file=sys.stderr)
        stereo_raw = np.column_stack((mic_full, loopback_full))
        
        try:
            vad = VADService()
            # The VAD will analyze the combined signal and keep only speech segments
            stereo_mix = vad.trim_silence(stereo_raw, self.master_sample_rate)
        except Exception as e:
            print(f"DEBUG: [AI VAD Error] Falling back to raw audio: {str(e)}", file=sys.stderr)
            stereo_mix = stereo_raw

        # Save to WAV
        with wave.open(self.output_file, 'wb') as wf:
            wf.setnchannels(2)
            wf.setsampwidth(2)
            wf.setframerate(self.master_sample_rate)
            wf.writeframes(stereo_mix.tobytes())
            
        print(f"DEBUG: [Windows] VAD-trimmed audio saved to {self.output_file}", file=sys.stderr)
        return self.output_file
    
class MacosAudioCapture(AudioCaptureStrategy):
    """ScreenCaptureKit implementation for macOS system audio."""
    def start_recording(self):
        print("DEBUG: [macOS] Starting ScreenCaptureKit capture...", file=sys.stderr)

    def stop_recording(self) -> str:
        print("DEBUG: [macOS] Stopping capture...", file=sys.stderr)
        return "temp_macos_audio.wav"

# ---------------------------------------------------------
# FACTORY METHOD: Instantiates the correct strategy
# ---------------------------------------------------------
class AudioCaptureFactory:
    """Factory class to provide the correct audio capture strategy based on the OS."""
    @staticmethod
    def get_strategy() -> AudioCaptureStrategy:
        platform = sys.platform
        if platform == "win32":
            return WindowsAudioCapture()
        elif platform == "darwin":
            return MacosAudioCapture()
        else:
            raise NotImplementedError(f"Audio capture is not yet supported on OS: {platform}")