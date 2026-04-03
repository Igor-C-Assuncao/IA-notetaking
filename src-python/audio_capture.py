# src-python/audio_capture.py
import sys
import os
import threading
import wave
import pyaudiowpatch as pyaudio
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
    """WASAPI loopback implementation using PyAudioWPatch (Robust for Windows)."""
    
    def __init__(self):
        self.is_recording = False
        self.record_thread = None
        self.frames = []
        
        # Paths
        current_dir = os.path.dirname(os.path.abspath(__file__))
        self.output_file = os.path.join(current_dir, "temp_system_audio.wav")
        
        # Audio configurations will be dynamically set based on the device
        self.channels = 2
        self.sample_rate = 44100
        self.sample_width = 2

    def start_recording(self):
        if self.is_recording:
            return

        self.is_recording = True
        self.frames = []
        
        self.record_thread = threading.Thread(target=self._record_loopback, daemon=True)
        self.record_thread.start()
        print("DEBUG: [Windows] Started PyAudioWPatch loopback capture...", file=sys.stderr)

    def _record_loopback(self):
        """Captures system audio using the default WASAPI loopback device."""
        p = pyaudio.PyAudio()
        stream = None
        try:
            # Fetch the default WASAPI loopback device safely
            default_loopback = p.get_default_wasapi_loopback()
            
            self.sample_rate = int(default_loopback["defaultSampleRate"])
            self.channels = default_loopback["maxInputChannels"]
            self.sample_width = p.get_sample_size(pyaudio.paInt16)
            
            # Open the stream
            stream = p.open(format=pyaudio.paInt16,
                            channels=self.channels,
                            rate=self.sample_rate,
                            input=True,
                            input_device_index=default_loopback["index"],
                            frames_per_buffer=1024)
            
            while self.is_recording:
                # exception_on_overflow=False prevents crashes if processing lags
                data = stream.read(1024, exception_on_overflow=False)
                self.frames.append(data)
                
        except Exception as e:
            print(f"DEBUG: [Windows Audio Error] PyAudio failed: {str(e)}", file=sys.stderr)
        finally:
            if stream is not None:
                stream.stop_stream()
                stream.close()
            p.terminate()

    def stop_recording(self) -> str:
        if not self.is_recording:
            return self.output_file

        self.is_recording = False
        
        if self.record_thread:
            self.record_thread.join(timeout=2.0)
            
        print("DEBUG: [Windows] Stopping capture and saving file...", file=sys.stderr)

        if len(self.frames) > 0:
            # Save the WAV file using the standard 'wave' module
            with wave.open(self.output_file, 'wb') as wf:
                wf.setnchannels(self.channels)
                wf.setsampwidth(self.sample_width)
                wf.setframerate(self.sample_rate)
                wf.writeframes(b''.join(self.frames))
                
            print(f"DEBUG: [Windows] File successfully saved to {self.output_file}", file=sys.stderr)
        else:
            print("DEBUG: [Windows WARNING] No audio frames captured.", file=sys.stderr)
            
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