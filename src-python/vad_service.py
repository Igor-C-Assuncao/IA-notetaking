# src-python/vad_service.py
import sys
import torch
import numpy as np

class VADService:
    """
    Service to detect speech segments and remove silence using Silero VAD.
    """
    def __init__(self):
        # Load the pre-trained Silero VAD model
        try:
            self.model, self.utils = torch.hub.load(
                repo_or_dir='snakers4/silero-vad',
                model='silero_vad',
                force_reload=False,
                onnx=False
            )
            self.get_speech_timestamps = self.utils[0]
        except Exception as e:
            print(f"DEBUG: [VAD Init Error] Failed to load Silero model: {e}", file=sys.stderr)
            self.model = None

    def trim_silence(self, audio_data: np.ndarray, sample_rate: int) -> np.ndarray:
        """
        Analyzes audio and returns only segments containing speech.
        """
        if self.model is None or audio_data.size == 0:
            return audio_data

        # 1. Convert to float32 and normalize for processing
        if audio_data.dtype != np.float32:
            audio_float = audio_data.astype(np.float32) / 32768.0
        else:
            audio_float = audio_data

        # 2. If stereo, mix to mono purely for the VAD detection step
        if len(audio_float.shape) > 1:
            detection_audio = np.mean(audio_float, axis=1)
        else:
            detection_audio = audio_float

        # 3. CRITICAL: Silero VAD requires 16000 Hz. 
        # We calculate the scale (e.g., 48000 / 16000 = 3) and decimate the array.
        scale = max(1, int(sample_rate / 16000))
        detection_audio_16k = detection_audio[::scale]

        # 4. Convert to PyTorch tensor
        tensor_audio = torch.from_numpy(detection_audio_16k)

        # 5. Get timestamps
        try:
            speech_timestamps = self.get_speech_timestamps(
                tensor_audio, 
                self.model, 
                sampling_rate=16000,
                threshold=0.3, # Lowered to 0.3 to be more sensitive and not cut soft voices
                min_speech_duration_ms=250,
                min_silence_duration_ms=500
            )
        except Exception as e:
            print(f"DEBUG: [VAD Processing Error] {e}", file=sys.stderr)
            return audio_data # Fallback to raw audio

        # 6. If no speech is found, return empty array
        if not speech_timestamps:
            print("DEBUG: [VAD] No speech detected in this recording.", file=sys.stderr)
            return np.array([], dtype=audio_data.dtype)

        # 7. Reconstruct the HIGH QUALITY audio using the detected timestamps
        segments = []
        for ts in speech_timestamps:
            # Multiply the 16k timestamps by our scale to map back to the 48k audio
            start_idx = ts['start'] * scale
            end_idx = ts['end'] * scale
            segments.append(audio_data[start_idx:end_idx])

        return np.concatenate(segments)