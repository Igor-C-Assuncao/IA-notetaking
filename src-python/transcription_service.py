# src-python/transcription_service.py
import sys
import os
import torch
import whisperx

# Suppress excessive TensorFlow/oneDNN warnings
os.environ['TF_CPP_MIN_LOG_LEVEL'] = '3' 
os.environ['TF_ENABLE_ONEDNN_OPTS'] = '0'

class TranscriptionService:
    """
    Service responsible for converting audio files to text using WhisperX.
    Includes cross-platform hardware detection (CUDA, MPS, CPU).
    """
    def __init__(self):
        # ---------------------------------------------------------
        # CROSS-PLATFORM HARDWARE DETECTION
        # ---------------------------------------------------------
        if torch.cuda.is_available():
            # Windows/Linux with NVIDIA GPU
            self.device = "cuda"
            self.compute_type = "float16" 
            print("DEBUG: [AI] Hardware Detectado: NVIDIA GPU (CUDA).", file=sys.stderr)
            
        elif torch.backends.mps.is_available():
            # macOS with Apple Silicon (M1/M2/M3)
            # Note: WhisperX/CTranslate2 sometimes has quirks with float16 on Mac,
            # float32 is a safer fallback for MPS if float16 crashes on certain Mac models.
            self.device = "mps"
            self.compute_type = "float16" 
            print("DEBUG: [AI] Hardware Detectado: Apple Silicon (MPS).", file=sys.stderr)
            
        else:
            # Fallback for standard computers
            self.device = "cpu"
            self.compute_type = "int8" 
            print("DEBUG: [AI Warning] Nenhuma GPU compatível encontrada. Rodando via CPU.", file=sys.stderr)
        
        print(f"DEBUG: [AI] Carregando modelo WhisperX 'base' via {self.device.upper()} usando {self.compute_type}...", file=sys.stderr)
        
        try:
            self.model = whisperx.load_model("base", self.device, compute_type=self.compute_type)
        except Exception as e:
            # Fallback de segurança: Se o modelo quebrar no MPS ou CUDA, tenta forçar CPU
            print(f"DEBUG: [AI Error] Falha na GPU: {str(e)}. Tentando fallback seguro para CPU...", file=sys.stderr)
            try:
                self.device = "cpu"
                self.compute_type = "int8"
                self.model = whisperx.load_model("base", self.device, compute_type=self.compute_type)
            except Exception as fallback_error:
                print(f"DEBUG: [AI Critical Error] Falha total no carregamento do modelo: {str(fallback_error)}", file=sys.stderr)
                self.model = None

    def transcribe(self, audio_path: str, language: str | None = None) -> str:
        if self.model is None:
            return "[Error: WhisperX model not loaded]"

        if not os.path.exists(audio_path):
            return f"[Transcription Error: audio file not found at {audio_path}]"

        if os.path.getsize(audio_path) < 1024:
            return "[Transcription Error: audio file is empty — recording may have been too short]"

        print(f"DEBUG: [AI] Transcribing audio file: {audio_path}", file=sys.stderr)

        try:
            audio = whisperx.load_audio(audio_path)
            result = self.model.transcribe(audio, batch_size=4, language=language)
            segments = result.get("segments", [])
            full_text = " ".join([seg["text"].strip() for seg in segments])

            print("DEBUG: [AI] Transcription completed successfully.", file=sys.stderr)
            return full_text.strip()

        except Exception as e:
            error_msg = f"[Transcription Error: {str(e)}]"
            print(f"DEBUG: {error_msg}", file=sys.stderr)
            return error_msg