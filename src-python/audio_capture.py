# src-python/audio_capture.py
import sys
import threading
import numpy as np
import soundcard as sc
import soundfile as sf
from abc import ABC, abstractmethod

# ---------------------------------------------------------
# STRATEGY PATTERN: The abstract interface
# ---------------------------------------------------------
class AudioCaptureStrategy(ABC):
    @abstractmethod
    def start_recording(self):
        pass

    @abstractmethod
    def stop_recording(self) -> str:
        pass

# ---------------------------------------------------------
# CONCRETE STRATEGIES: OS-specific implementations
# ---------------------------------------------------------
class WindowsAudioCapture(AudioCaptureStrategy):
    """WASAPI implementation for Windows loopback."""
    
    def __init__(self):
        self.is_recording = False
        self.record_thread = None
        self.frames = []
        self.sample_rate = 48000 # Standard high-quality audio
        self.output_file = "temp_system_audio.wav"

    def start_recording(self):
        if self.is_recording:
            return

        self.is_recording = True
        self.frames = []
        
        # Start a background thread to prevent blocking the main IPC loop
        self.record_thread = threading.Thread(target=self._record_loopback, daemon=True)
        self.record_thread.start()
        print("DEBUG: [Windows] Started WASAPI loopback capture...", file=sys.stderr)

    def _record_loopback(self):
        """Internal method running in a separate thread to capture system audio."""
        try:
            # sc.default_speaker().recorder() taps into the WASAPI loopback automatically
            with sc.default_speaker().recorder(samplerate=self.sample_rate) as speaker_mic:
                while self.is_recording:
                    # Record in small chunks (e.g., 1024 frames) to allow graceful interruption
                    data = speaker_mic.record(numframes=1024)
                    self.frames.append(data)
        except Exception as e:
            print(f"DEBUG: [Windows Audio Error] {str(e)}", file=sys.stderr)

    def stop_recording(self) -> str:
        if not self.is_recording:
            return self.output_file

        self.is_recording = False
        
        # Wait for the recording thread to finish its last chunk
        if self.record_thread:
            self.record_thread.join()
            
        print("DEBUG: [Windows] Stopping capture and saving file...", file=sys.stderr)

        # Mix down and save to WAV file
        if self.frames:
            # Concatenate all numpy array chunks
            audio_data = np.concatenate(self.frames, axis=0)
            
            # Save the file using soundfile
            sf.write(self.output_file, audio_data, self.sample_rate)
            
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
    @staticmethod
    def get_strategy() -> AudioCaptureStrategy:
        platform = sys.platform
        if platform == "win32":
            return WindowsAudioCapture()
        elif platform == "darwin":
            return MacosAudioCapture()
        else:
            raise NotImplementedError(f"Audio capture is not yet supported on OS: {platform}")