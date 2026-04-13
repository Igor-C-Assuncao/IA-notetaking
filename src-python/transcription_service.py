# src-python/transcription_service.py
import sys
import os
import torch
import whisperx

# 1. NEW: Suppress excessive TensorFlow/oneDNN warnings
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3' 
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'

class TranscriptionService:
    """
    Service responsible for converting audio files to text using WhisperX.
    """
    def __init__(self):
        # 2. Check if CUDA is available after installing the correct PyTorch version
        if torch.cuda.is_available():
            self.device = "cuda"
            self.compute_type = "float16" # Fastest and uses less VRAM
        else:
            self.device = "cpu"
            self.compute_type = "int8" # Safe fallback for CPU
            print("DEBUG: [AI Warning] CUDA not found. Running on CPU (This will be very slow).", file=sys.stderr)
        
        print(f"DEBUG: [AI] Loading WhisperX model 'base' on {self.device.upper()} using {self.compute_type}...", file=sys.stderr)
        
        try:
            # We use the "base" model for a good balance of speed and accuracy. 
            self.model = whisperx.load_model("base", self.device, compute_type=self.compute_type)
        except Exception as e:
            print(f"DEBUG: [AI Error] Failed to load WhisperX model: {str(e)}", file=sys.stderr)
            self.model = None

    def transcribe(self, audio_path: str) -> str:
        """
        Loads the audio file, transcribes it, and returns the concatenated text.
        """
        if self.model is None:
            return "[Error: WhisperX model not loaded]"

        print(f"DEBUG: [AI] Transcribing audio file: {audio_path}", file=sys.stderr)
        
        try:
            # whisperx loads the audio and automatically converts to mono 16kHz for the model
            audio = whisperx.load_audio(audio_path)
            
            # Perform the transcription
            result = self.model.transcribe(audio, batch_size=4)
            
            # Extract and concatenate the text from all segments
            segments = result.get("segments", [])
            full_text = " ".join([seg["text"].strip() for seg in segments])
            
            print("DEBUG: [AI] Transcription completed successfully.", file=sys.stderr)
            return full_text.strip()
            
        except Exception as e:
            error_msg = f"[Transcription Error: {str(e)}]"
            print(f"DEBUG: {error_msg}", file=sys.stderr)
            return error_msg