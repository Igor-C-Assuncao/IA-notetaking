# src-python/audio_capture.py
import sys
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
        """Stops capturing and returns the path to the temporary audio file."""
        pass

# ---------------------------------------------------------
# CONCRETE STRATEGIES: OS-specific implementations
# ---------------------------------------------------------
class WindowsAudioCapture(AudioCaptureStrategy):
    """WASAPI implementation for Windows loopback and microphone."""
    
    def start_recording(self):
        # Implementation for Card 2.2 will go here
        print("DEBUG: [Windows] Starting WASAPI loopback capture...")

    def stop_recording(self) -> str:
        print("DEBUG: [Windows] Stopping capture...")
        return "temp_windows_audio.wav"

class MacosAudioCapture(AudioCaptureStrategy):
    """ScreenCaptureKit implementation for macOS system audio."""
    
    def start_recording(self):
        # Implementation for macOS will go here
        print("DEBUG: [macOS] Starting ScreenCaptureKit capture...")

    def stop_recording(self) -> str:
        print("DEBUG: [macOS] Stopping capture...")
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