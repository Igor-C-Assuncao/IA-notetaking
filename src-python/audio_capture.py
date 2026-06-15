# src-python/audio_capture.py
import sys
import os
import time
import subprocess
import threading
import wave
import numpy as np
import torch
import torchaudio.transforms as T
if sys.platform == "win32":
    import pyaudiowpatch as pyaudio
elif sys.platform == "darwin":
    import pyaudio
else:
    pyaudio = None
from abc import ABC, abstractmethod
from vad_service import VADService


def list_audio_devices() -> list:
    """
    Returns a list of available audio input devices on the current platform.
    Each entry: {id, name, type}  where type is 'mic' or 'loopback'.
    Safe to call at any time — opens and closes PyAudio/soundcard internally.
    """
    if os.environ.get("IS_TESTING") == "1":
        return [{"id": 0, "name": "Mock Microphone", "type": "mic"}]


    devices = []
    if sys.platform.startswith("linux"):
        try:
            import soundcard as sc
            mics = sc.all_microphones(include_loopback=True, exclude_monitors=False)
            for idx, mic in enumerate(mics):
                name = mic.name
                is_loopback = "monitor" in name.lower() or "loopback" in name.lower()
                devices.append({
                    "id": idx,
                    "name": name,
                    "type": "loopback" if is_loopback else "mic",
                })
        except Exception as e:
            print(f"DEBUG: [Linux AudioDevices] Failed to enumerate devices: {e}", file=sys.stderr)
        return devices

    if pyaudio is None:
        print("DEBUG: [AudioDevices] PyAudio is unavailable on this platform.", file=sys.stderr)
        return devices

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
    def start_recording(self, telemetry_callback=None, system_audio: bool = False, device_id=None):
        """Starts capturing audio. Optional callback(level: float) for RMS telemetry. Accepts system_audio toggle."""
        pass

    @abstractmethod
    def pause_recording(self):
        """Temporarily stops appending captured frames."""
        pass

    @abstractmethod
    def resume_recording(self):
        """Resumes appending captured frames."""
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
        self.is_paused = False
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

        # Timestamp markers for synchronization
        self.mic_start_time = None
        self.loopback_start_time = None

        current_dir = os.path.dirname(os.path.abspath(__file__))
        self.output_file = os.path.join(current_dir, "temp_meeting_audio.wav")

    def pause_recording(self):
        self.is_paused = True
        print("DEBUG: [Windows] Recording paused.", file=sys.stderr)

    def resume_recording(self):
        self.is_paused = False
        print("DEBUG: [Windows] Recording resumed.", file=sys.stderr)

    def start_recording(self, telemetry_callback=None, system_audio: bool = False, device_id=None):
        if self.is_recording:
            return

        self.is_recording = True
        self.is_paused = False
        self.telemetry_callback = telemetry_callback
        self.loopback_frames = []
        self.mic_frames = []
        self.mic_start_time = None
        self.loopback_start_time = None
        
        # Defensive programming: delete previous session audio if it exists
        if os.path.exists(self.output_file):
            try:
                os.remove(self.output_file)
                print("DEBUG: [Windows] Outdated meeting audio file removed.", file=sys.stderr)
            except Exception as e:
                print(f"DEBUG: [Windows] Failed to delete previous audio: {e}", file=sys.stderr)

        # 1. Initialize PyAudio ONCE in the main thread
        self.p = pyaudio.PyAudio()

        # 2. Safely open the Loopback stream
        if system_audio:
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
        else:
            self.loopback_stream = None

        # 3. Safely open the Microphone stream
        try:
            mic_device = (
                self.p.get_device_info_by_index(int(device_id))
                if device_id is not None
                else self.p.get_default_input_device_info()
            )
            if mic_device.get("maxInputChannels", 0) < 1:
                raise ValueError("Selected device is not an input device")
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
                if self.is_paused:
                    continue
                if self.loopback_start_time is None:
                    self.loopback_start_time = time.perf_counter()
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
                if self.is_paused:
                    continue
                if self.mic_start_time is None:
                    self.mic_start_time = time.perf_counter()
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

        # Clean up streams and PyAudio instance to prevent leaks and PortAudio thread collisions
        if self.loopback_stream:
            try:
                self.loopback_stream.stop_stream()
                self.loopback_stream.close()
            except Exception as e:
                print(f"DEBUG: [Windows Audio] Error closing loopback stream: {e}", file=sys.stderr)
            self.loopback_stream = None

        if self.mic_stream:
            try:
                self.mic_stream.stop_stream()
                self.mic_stream.close()
            except Exception as e:
                print(f"DEBUG: [Windows Audio] Error closing mic stream: {e}", file=sys.stderr)
            self.mic_stream = None

        if self.p:
            try:
                self.p.terminate()
            except Exception as e:
                print(f"DEBUG: [Windows Audio] Error terminating PyAudio: {e}", file=sys.stderr)
            self.p = None

        if not self.loopback_frames and not self.mic_frames:
            return self.output_file

        # Build raw arrays
        mic_full = np.concatenate(self.mic_frames) if self.mic_frames else np.array([], dtype=np.int16)
        loopback_full = np.concatenate(self.loopback_frames) if self.loopback_frames else np.array([], dtype=np.int16)

        # Mix streams
        if mic_full.size > 0 and loopback_full.size > 0:
            if self.mic_start_time and self.loopback_start_time:
                # Calculate start offset in seconds and samples
                start_diff = self.mic_start_time - self.loopback_start_time
                sample_diff = int(abs(start_diff) * self.master_sample_rate)
                
                if start_diff > 0:
                    # Mic started AFTER loopback -> pad Mic start with silence
                    mic_full = np.pad(mic_full, (sample_diff, 0), mode='constant')
                else:
                    # Loopback started AFTER mic -> pad Loopback start with silence
                    loopback_full = np.pad(loopback_full, (sample_diff, 0), mode='constant')

            # Sync tail lengths
            max_len = max(len(mic_full), len(loopback_full))
            if len(mic_full) < max_len:
                mic_full = np.pad(mic_full, (0, max_len - len(mic_full)), mode='constant')
            if len(loopback_full) < max_len:
                loopback_full = np.pad(loopback_full, (0, max_len - len(loopback_full)), mode='constant')
            
            # Smart Voice-Priority Mixing (70% mic, 30% system audio) to prevent system audio drown-out
            # Using soft limiting to prevent harsh square-wave clipping
            mixed_f32 = (mic_full.astype(np.float32) * 0.7) + (loopback_full.astype(np.float32) * 0.3)
            mixed_48k = np.clip(mixed_f32, -32768, 32767).astype(np.int16)
        else:
            mixed_48k = mic_full

        if mixed_48k.size == 0:
            return self.output_file

        # High-Quality Anti-Aliased Resampling using PyTorch/Torchaudio
        try:
            # Convert numpy array to float32 tensor in range [-1.0, 1.0] for PyTorch
            audio_tensor = torch.from_numpy(mixed_48k).float() / 32768.0
            
            # Initialize Kaiser windowed sinc interpolation resampler
            resampler = T.Resample(
                orig_freq=self.master_sample_rate, 
                new_freq=16000, 
                resampling_method="sinc_interp_kaiser"
            )
            
            resampled_tensor = resampler(audio_tensor)
            
            # Convert back to standard int16 numpy array
            mixed_16k = (resampled_tensor.numpy() * 32767.0).clip(-32768, 32767).astype(np.int16)
            print("DEBUG: [AI] Anti-aliased torchaudio resampling completed (48kHz -> 16kHz).", file=sys.stderr)
        except Exception as resample_err:
            # Robust fallback to naive decimation in case of PyTorch/torchaudio issues
            print(f"DEBUG: [AI Resample Fallback] Error in torchaudio resample: {resample_err}. Slicing instead.", file=sys.stderr)
            mixed_16k = mixed_48k[::3]

        # Apply VAD to remove silence before saving
        print("DEBUG: [AI] Running Silero VAD to trim silence...", file=sys.stderr)
        try:
            vad = VADService()
            # The VAD will analyze the mono 16kHz signal and keep only speech segments
            mono_trimmed = vad.trim_silence(mixed_16k, 16000)
        except Exception as e:
            print(f"DEBUG: [AI VAD Error] Falling back to raw audio: {str(e)}", file=sys.stderr)
            mono_trimmed = mixed_16k

        # Save to WAV
        with wave.open(self.output_file, 'wb') as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes(mono_trimmed.tobytes())
            
        print(f"DEBUG: [Windows] VAD-trimmed mono 16kHz audio saved to {self.output_file}", file=sys.stderr)
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

    def start_recording(self, telemetry_callback=None, system_audio: bool = False, device_id=None):
        if self.is_recording:
            return
        self.is_recording = True
        self.is_paused = False
        self.telemetry_callback = telemetry_callback
        self.mic_frames = []

        # Defensive programming: delete previous session audio if it exists
        if os.path.exists(self.output_file):
            try:
                os.remove(self.output_file)
                print("DEBUG: [macOS] Outdated meeting audio file removed.", file=sys.stderr)
            except Exception as e:
                print(f"DEBUG: [macOS] Failed to delete previous audio: {e}", file=sys.stderr)

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
                input_device_index=int(device_id) if device_id is not None else None,
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
                if self.telemetry_callback:
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


class LinuxAudioCapture(AudioCaptureStrategy):
    """
    Robust Linux implementation capturing default microphone and monitor loopback
    via standard PulseAudio/PipeWire using the soundcard library.
    """
    def __init__(self):
        self.is_recording = False
        self.is_paused = False
        self.telemetry_callback = None

        self.mic = None
        self.loopback = None

        self.mic_thread = None
        self.loopback_thread = None

        self.mic_frames = []
        self.loopback_frames = []

        self.sample_rate = 16000
        self.channels = 1

        current_dir = os.path.dirname(os.path.abspath(__file__))
        self.output_file = os.path.join(current_dir, "temp_meeting_audio.wav")

    def pause_recording(self):
        self.is_paused = True
        print("DEBUG: [Linux] Recording paused.", file=sys.stderr)

    def resume_recording(self):
        self.is_paused = False
        print("DEBUG: [Linux] Recording resumed.", file=sys.stderr)

    def start_recording(self, telemetry_callback=None, system_audio: bool = False, device_id=None):
        if self.is_recording:
            return

        self.is_recording = True
        self.is_paused = False
        self.telemetry_callback = telemetry_callback
        self.mic_frames = []
        self.loopback_frames = []

        # Defensive programming: delete previous session audio
        if os.path.exists(self.output_file):
            try:
                os.remove(self.output_file)
                print("DEBUG: [Linux] Outdated meeting audio file removed.", file=sys.stderr)
            except Exception as e:
                print(f"DEBUG: [Linux] Failed to delete previous audio: {e}", file=sys.stderr)

        import soundcard as sc

        # 1. Open default Microphone
        try:
            if device_id is None:
                self.mic = sc.default_microphone()
            else:
                devices = sc.all_microphones(include_loopback=True, exclude_monitors=False)
                selected = devices[int(device_id)]
                name = selected.name.lower()
                if "monitor" in name or "loopback" in name:
                    raise ValueError("Selected device is not a microphone")
                self.mic = selected
            self.mic_thread = threading.Thread(target=self._record_mic, daemon=True)
            self.mic_thread.start()
            print("DEBUG: [Linux] Microphone capture thread started.", file=sys.stderr)
        except Exception as e:
            print(f"DEBUG: [Linux] Failed to start microphone: {e}", file=sys.stderr)
            self.mic = None

        # 2. Open Loopback System Audio (monitor source)
        self.loopback = None
        if system_audio:
            try:
                mics = sc.all_microphones(include_loopback=True, exclude_monitors=False)
                for dev in mics:
                    if "monitor" in dev.name.lower() or "loopback" in dev.name.lower():
                        self.loopback = dev
                        break
                
                if self.loopback:
                    self.loopback_thread = threading.Thread(target=self._record_loopback, daemon=True)
                    self.loopback_thread.start()
                    print(f"DEBUG: [Linux] System audio capture thread started ({self.loopback.name}).", file=sys.stderr)
                else:
                    print("DEBUG: [Linux Warning] Loopback monitor source not found. Mic-only capture.", file=sys.stderr)
                    import json
                    print(json.dumps({"event": "ERROR", "data": {"message": "System audio loopback is unavailable on Linux. Recording microphone only."}}))
                    sys.stdout.flush()
            except Exception as e:
                print(f"DEBUG: [Linux] Failed to start loopback capture: {e}", file=sys.stderr)
                import json
                print(json.dumps({"event": "ERROR", "data": {"message": f"Failed to start system loopback capture: {str(e)}"}}))
                sys.stdout.flush()

    def _record_mic(self):
        chunk_count = 0
        try:
            with self.mic.recorder(samplerate=self.sample_rate, channels=self.channels) as recorder:
                while self.is_recording:
                    if self.is_paused:
                        time.sleep(0.05)
                        continue
                    data = recorder.record(numframes=1024)
                    int_data = np.clip(data * 32767.0, -32768, 32767).astype(np.int16)
                    
                    if len(int_data.shape) > 1 and int_data.shape[1] > 1:
                        int_data = np.mean(int_data, axis=1).astype(np.int16)
                    else:
                        int_data = int_data.flatten()

                    self.mic_frames.append(int_data)

                    if self.telemetry_callback:
                        rms = float(np.sqrt(np.mean(int_data.astype(np.float32) ** 2)))
                        level = min(rms / 32768.0, 1.0)
                        self.telemetry_callback(level)
        except Exception as e:
            print(f"DEBUG: [Linux Mic Error] {e}", file=sys.stderr)

    def _record_loopback(self):
        try:
            with self.loopback.recorder(samplerate=self.sample_rate, channels=self.channels) as recorder:
                while self.is_recording:
                    if self.is_paused:
                        time.sleep(0.05)
                        continue
                    data = recorder.record(numframes=1024)
                    int_data = np.clip(data * 32767.0, -32768, 32767).astype(np.int16)
                    if len(int_data.shape) > 1 and int_data.shape[1] > 1:
                        int_data = np.mean(int_data, axis=1).astype(np.int16)
                    else:
                        int_data = int_data.flatten()
                    self.loopback_frames.append(int_data)
        except Exception as e:
            print(f"DEBUG: [Linux Loopback Error] {e}", file=sys.stderr)

    def stop_recording(self) -> str:
        if not self.is_recording:
            return self.output_file

        self.is_recording = False

        if self.mic_thread:
            self.mic_thread.join(timeout=2.0)
        if self.loopback_thread:
            self.loopback_thread.join(timeout=2.0)

        if not self.mic_frames:
            print("DEBUG: [Linux] No microphone frames captured.", file=sys.stderr)
            return self.output_file

        mic_full = np.concatenate(self.mic_frames)

        if self.loopback_frames:
            loopback_full = np.concatenate(self.loopback_frames)
            min_len = min(len(mic_full), len(loopback_full))
            # 50/50 mix
            mixed = np.clip(
                (mic_full[:min_len].astype(np.float32) + loopback_full[:min_len].astype(np.float32)) * 0.5,
                -32768, 32767
            ).astype(np.int16)
            audio_input = mixed.reshape(-1, 1)
            print("DEBUG: [Linux] Mixed mic + system audio (50/50).", file=sys.stderr)
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

        print(f"DEBUG: [Linux] Audio saved to {self.output_file}", file=sys.stderr)
        return self.output_file


# ---------------------------------------------------------
# FACTORY METHOD: Instantiates the correct strategy
# ---------------------------------------------------------
class AudioCaptureFactory:
    """Factory class to provide the correct audio capture strategy based on the OS."""
    @staticmethod
    def get_strategy() -> AudioCaptureStrategy:
        if os.environ.get("IS_TESTING") == "1":
            print("DEBUG: [AI] Using MockAudioCapture strategy for testing.", file=sys.stderr)
            class MockAudioCapture:
                def start_recording(self, *args, **kwargs): pass
                def stop_recording(self, *args, **kwargs): return "temp_meeting_audio.wav"
                def pause_recording(self): pass
                def resume_recording(self): pass
            return MockAudioCapture()

        platform = sys.platform
        if platform == "win32":
            return WindowsAudioCapture()
        elif platform == "darwin":
            return MacosAudioCapture()
        elif platform.startswith("linux"):
            return LinuxAudioCapture()
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
        """float32 stereo 48kHz → int16 mono 16kHz."""
        from scipy.signal import resample_poly
        samples = np.frombuffer(raw, dtype=np.float32)
        # Reshape to (frames, 2) and downmix to mono
        if len(samples) % 2 != 0:
            samples = samples[:-1]
        stereo = samples.reshape(-1, 2)
        mono_f32 = stereo.mean(axis=1)
        # Resample 48kHz → 16kHz (ratio 1:3)
        mono_16k = resample_poly(mono_f32, 1, 3).astype(np.float32)
        # Convert float32 → int16
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
