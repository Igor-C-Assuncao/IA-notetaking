# src-python/audio_capture.py
import sys
import os
import subprocess
import threading
import wave
import numpy as np
if sys.platform == "win32":
    import pyaudiowpatch as pyaudio
else:
    import pyaudio
from abc import ABC, abstractmethod
from vad_service import VADService


def list_audio_devices() -> list:
    """
    Returns a list of available audio input devices on the current platform.
    Each entry: {id, name, type}  where type is 'mic' or 'loopback'.
    Safe to call at any time — opens and closes PyAudio internally.
    """
    devices = []
    try:
        p = pyaudio.PyAudio()
        count = p.get_device_count()
        for i in range(count):
            try:
                info = p.get_device_info_by_index(i)
                if info.get("maxInputChannels", 0) < 1:
                    continue
                name = info.get("name", f"Device {i}")
                # On Windows with pyaudiowpatch, loopback devices have
                # 'Loopback' in the name or come from the wasapi loopback API.
                is_loopback = "loopback" in name.lower()
                devices.append({
                    "id": i,
                    "name": name,
                    "type": "loopback" if is_loopback else "mic",
                })
            except Exception:
                continue
        p.terminate()
    except Exception as e:
        print(f"DEBUG: [AudioDevices] Failed to enumerate devices: {e}", file=sys.stderr)
    return devices

# ---------------------------------------------------------
# STRATEGY PATTERN: The abstract interface
# ---------------------------------------------------------
class AudioCaptureStrategy(ABC):
    """
    Abstract base class defining the contract for all audio capture strategies.
    """
    @abstractmethod
    def start_recording(self, telemetry_callback=None):
        """Starts capturing audio. Optional callback(level: float) for RMS telemetry."""
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
        self.telemetry_callback = None

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

    def start_recording(self, telemetry_callback=None):
        if self.is_recording:
            return

        self.is_recording = True
        self.telemetry_callback = telemetry_callback
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
        chunk_count = 0
        try:
            while self.is_recording and self.mic_stream:
                data = self.mic_stream.read(1024, exception_on_overflow=False)
                audio_data = np.frombuffer(data, dtype=np.int16)

                if self.mic_channels > 1:
                    audio_data = np.reshape(audio_data, (-1, self.mic_channels))
                    audio_data = np.mean(audio_data, axis=1).astype(np.int16)

                self.mic_frames.append(audio_data)

                # Emit RMS telemetry every 5th chunk
                chunk_count += 1
                if chunk_count % 5 == 0 and self.telemetry_callback:
                    rms = float(np.sqrt(np.mean(audio_data.astype(np.float32) ** 2)))
                    level = min(rms / 32768.0, 1.0)
                    self.telemetry_callback(level)
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
    """
    macOS audio capture:
    - Microphone via PyAudio (always)
    - System audio via Core Audio Tap Swift binary (macOS 14.4+, optional)
    """

    def __init__(self):
        self.is_recording = False
        self.is_paused = False
        self.telemetry_callback = None
        self.p = None
        self.mic_stream = None
        self.mic_thread = None
        self.mic_frames = []
        self.sample_rate = 16000
        self.channels = 1
        self._sys_mixer = None

        current_dir = os.path.dirname(os.path.abspath(__file__))
        self.output_file = os.path.join(current_dir, "temp_meeting_audio.wav")

    def pause_recording(self):
        self.is_paused = True
        print("DEBUG: [macOS] Recording paused.", file=sys.stderr)

    def resume_recording(self):
        self.is_paused = False
        print("DEBUG: [macOS] Recording resumed.", file=sys.stderr)

    def start_recording(self, telemetry_callback=None, system_audio: bool = False):
        if self.is_recording:
            return
        self.is_recording = True
        self.is_paused = False
        self.telemetry_callback = telemetry_callback
        self.mic_frames = []

        self._sys_mixer = None
        if system_audio:
            binary = MacosSystemAudioMixer.find_binary()
            if binary:
                mixer = MacosSystemAudioMixer(binary)
                if mixer.start():
                    self._sys_mixer = mixer
            if not self._sys_mixer:
                print("DEBUG: [macOS] System audio unavailable — mic only.", file=sys.stderr)

        try:
            self.p = pyaudio.PyAudio()
            self.mic_stream = self.p.open(
                format=pyaudio.paInt16,
                channels=self.channels,
                rate=self.sample_rate,
                input=True,
                frames_per_buffer=1024,
            )
            self.mic_thread = threading.Thread(target=self._record, daemon=True)
            self.mic_thread.start()
            print("DEBUG: [macOS] Microphone capture started.", file=sys.stderr)
        except Exception as e:
            print(f"DEBUG: [macOS] Failed to start microphone: {e}", file=sys.stderr)
            self.is_recording = False

    def _record(self):
        chunk_count = 0
        try:
            while self.is_recording and self.mic_stream:
                data = self.mic_stream.read(1024, exception_on_overflow=False)
                if self.is_paused:
                    continue
                audio_data = np.frombuffer(data, dtype=np.int16)
                self.mic_frames.append(audio_data)
                chunk_count += 1
                if chunk_count % 5 == 0 and self.telemetry_callback:
                    rms = float(np.sqrt(np.mean(audio_data.astype(np.float32) ** 2)))
                    level = min(rms / 32768.0, 1.0)
                    self.telemetry_callback(level)
        except Exception as e:
            print(f"DEBUG: [macOS Mic Error] {e}", file=sys.stderr)

    def stop_recording(self) -> str:
        if not self.is_recording:
            return self.output_file
        self.is_recording = False
        if self.mic_thread:
            self.mic_thread.join(timeout=2.0)
        if self.mic_stream:
            try:
                self.mic_stream.stop_stream()
                self.mic_stream.close()
            except Exception:
                pass
        if self.p:
            self.p.terminate()

        if not self.mic_frames:
            print("DEBUG: [macOS] No audio frames captured.", file=sys.stderr)
            return self.output_file

        mic_full = np.concatenate(self.mic_frames)

        sys_frames = self._sys_mixer.stop() if self._sys_mixer else None
        self._sys_mixer = None

        if sys_frames is not None and len(sys_frames) > 0:
            min_len = min(len(mic_full), len(sys_frames))
            mixed = np.clip(
                mic_full[:min_len].astype(np.int32) + sys_frames[:min_len].astype(np.int32),
                -32768, 32767
            ).astype(np.int16)
            audio_input = mixed.reshape(-1, 1)
            print("DEBUG: [macOS] Mixed mic + system audio.", file=sys.stderr)
        else:
            audio_input = mic_full.reshape(-1, 1)

        print("DEBUG: [AI] Running Silero VAD to trim silence...", file=sys.stderr)
        try:
            vad = VADService()
            audio_trimmed = vad.trim_silence(audio_input, self.sample_rate)
        except Exception as e:
            print(f"DEBUG: [AI VAD Error] Falling back to raw audio: {e}", file=sys.stderr)
            audio_trimmed = audio_input

        with wave.open(self.output_file, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(self.sample_rate)
            wf.writeframes(audio_trimmed.tobytes())

        print(f"DEBUG: [macOS] Audio saved to {self.output_file}", file=sys.stderr)
        return self.output_file

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


# ---------------------------------------------------------
# macOS SYSTEM AUDIO — Core Audio Tap helper
# Spawns the Swift binary, reads raw PCM from its stdout,
# and mixes it with the microphone before passing to VAD.
# Requires: src-tauri/binaries/audio-tap-{arch}-apple-darwin
#           built from audio-tap.swift
# ---------------------------------------------------------
class MacosSystemAudioMixer:
    """
    Reads Float32 stereo 48kHz PCM from the Swift tap binary stdout.
    Normalizes to int16 mono 16kHz so it can be mixed with the mic stream.
    Used internally by MacosAudioCapture when system_audio=True.
    """

    CHUNK = 4096 * 2 * 4  # 4096 frames × 2 ch × 4 bytes (float32)

    def __init__(self, binary_path: str):
        self.binary_path = binary_path
        self.proc = None
        self.thread = None
        self.frames: list = []
        self._running = False

    def start(self) -> bool:
        """Spawn the Swift binary. Returns False if binary not found or old macOS."""
        if not os.path.exists(self.binary_path):
            print(f"DEBUG: [CATap] Binary not found: {self.binary_path}", file=sys.stderr)
            return False
        try:
            self.proc = subprocess.Popen(
                [self.binary_path],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            # Check stderr for READY or FALLBACK_SCKIT
            stderr_line = self.proc.stderr.readline().decode().strip()
            if "FALLBACK_SCKIT" in stderr_line:
                print("DEBUG: [CATap] macOS < 14.4 — system audio unavailable.", file=sys.stderr)
                self.proc.terminate()
                return False
            if "ERROR" in stderr_line:
                print(f"DEBUG: [CATap] {stderr_line}", file=sys.stderr)
                self.proc.terminate()
                return False
            self._running = True
            self.thread = threading.Thread(target=self._read_loop, daemon=True)
            self.thread.start()
            print("DEBUG: [CATap] System audio capture started.", file=sys.stderr)
            return True
        except Exception as e:
            print(f"DEBUG: [CATap] Failed to start: {e}", file=sys.stderr)
            return False

    def _read_loop(self):
        while self._running and self.proc and self.proc.stdout:
            chunk = self.proc.stdout.read(self.CHUNK)
            if not chunk:
                break
            pcm = self._normalize(chunk)
            self.frames.append(pcm)

    @staticmethod
    def _normalize(raw: bytes) -> np.ndarray:
        """
        Normalize Swift tap output to int16 mono 16kHz for mixing with mic.
        Native format from CATap aggregate device: Float32 mono 44100 Hz.
        """
        from scipy.signal import resample_poly
        mono_f32 = np.frombuffer(raw, dtype=np.float32).copy()
        # Resample 44100 Hz -> 16000 Hz (ratio 160:441)
        mono_16k = resample_poly(mono_f32, 160, 441).astype(np.float32)
        # Convert float32 -> int16
        return (mono_16k * 32768).clip(-32768, 32767).astype(np.int16)

    def stop(self) -> np.ndarray | None:
        self._running = False
        if self.proc and self.proc.stdin:
            try:
                self.proc.stdin.write(b"stop\n")
                self.proc.stdin.flush()
            except Exception:
                pass
        if self.thread:
            self.thread.join(timeout=2.0)
        if self.proc:
            self.proc.terminate()
        if not self.frames:
            return None
        return np.concatenate(self.frames)

    @staticmethod
    def find_binary() -> str | None:
        """Locate the Swift binary bundled alongside the app."""
        import platform as _platform
        arch = _platform.machine()  # arm64 or x86_64
        name = f"audio-tap-{arch}-apple-darwin"
        # When running from Tauri: binary is next to the executable
        candidates = [
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", name),
            os.path.join(os.path.dirname(os.path.abspath(__file__)), name),
        ]
        for p in candidates:
            if os.path.exists(p):
                return os.path.abspath(p)
        return None