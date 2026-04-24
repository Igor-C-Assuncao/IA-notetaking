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
    Supports optional speaker diarization via pyannote.audio.
    Includes cross-platform hardware detection (CUDA, MPS, CPU).
    """

    def __init__(self):
        # ── Hardware detection ─────────────────────────────────────
        if torch.cuda.is_available():
            self.device = "cuda"
            self.compute_type = "float16"
            print("DEBUG: [AI] Hardware Detectado: NVIDIA GPU (CUDA).", file=sys.stderr)

        elif torch.backends.mps.is_available():
            self.device = "mps"
            self.compute_type = "float16"
            print("DEBUG: [AI] Hardware Detectado: Apple Silicon (MPS).", file=sys.stderr)

        else:
            self.device = "cpu"
            self.compute_type = "int8"
            print("DEBUG: [AI Warning] Nenhuma GPU compatível encontrada. Rodando via CPU.", file=sys.stderr)

        print(
            f"DEBUG: [AI] Carregando modelo WhisperX 'base' via "
            f"{self.device.upper()} usando {self.compute_type}...",
            file=sys.stderr,
        )

        try:
            self.model = whisperx.load_model(
                "base", self.device, compute_type=self.compute_type
            )
        except Exception as e:
            print(
                f"DEBUG: [AI Error] Falha na GPU: {str(e)}. Tentando fallback para CPU...",
                file=sys.stderr,
            )
            try:
                self.device = "cpu"
                self.compute_type = "int8"
                self.model = whisperx.load_model(
                    "base", self.device, compute_type=self.compute_type
                )
            except Exception as fallback_error:
                print(
                    f"DEBUG: [AI Critical Error] Falha total: {str(fallback_error)}",
                    file=sys.stderr,
                )
                self.model = None

    # ── Plain transcription ────────────────────────────────────────
    def transcribe(
        self,
        audio_path: str,
        language: str | None = None,
        speaker_diarization: bool = False,
        hf_token: str | None = None,
    ) -> dict:
        """
        Transcribes audio and optionally diarizes speakers.

        Returns a dict:
          {
            "text": str,                     # plain joined text (always present)
            "segments": list | None,         # [{speaker, start, end, text}] or None
            "diarized": bool,
          }
        """
        if self.model is None:
            return self._error("WhisperX model not loaded")

        if not os.path.exists(audio_path):
            return self._error(f"audio file not found at {audio_path}")

        if os.path.getsize(audio_path) < 1024:
            return self._error("audio file is empty — recording may have been too short")

        print(f"DEBUG: [AI] Transcribing: {audio_path}", file=sys.stderr)

        try:
            audio = whisperx.load_audio(audio_path)
            result = self.model.transcribe(audio, batch_size=4, language=language)
            segments = result.get("segments", [])
            detected_language = result.get("language", language or "en")

            # ── Alignment (word-level timestamps — required for diarization) ──
            try:
                align_model, metadata = whisperx.load_align_model(
                    language_code=detected_language, device=self.device
                )
                result = whisperx.align(
                    segments, align_model, metadata, audio, self.device,
                    return_char_alignments=False,
                )
                segments = result.get("segments", segments)
                print("DEBUG: [AI] Alignment completed.", file=sys.stderr)
            except Exception as align_err:
                print(
                    f"DEBUG: [AI] Alignment skipped: {align_err}", file=sys.stderr
                )

            plain_text = " ".join(
                seg.get("text", "").strip() for seg in segments
            ).strip()

            # ── Diarization (optional) ─────────────────────────────
            if speaker_diarization:
                diarized_segments = self._diarize(
                    audio, segments, detected_language, hf_token
                )
                if diarized_segments is not None:
                    print("DEBUG: [AI] Diarization completed.", file=sys.stderr)
                    return {
                        "text": plain_text,
                        "segments": diarized_segments,
                        "diarized": True,
                    }
                # Diarization failed — fall through to plain text
                print(
                    "DEBUG: [AI] Diarization failed, falling back to plain text.",
                    file=sys.stderr,
                )

            print("DEBUG: [AI] Transcription completed successfully.", file=sys.stderr)
            return {"text": plain_text, "segments": None, "diarized": False}

        except Exception as e:
            return self._error(str(e))

    def _diarize(
        self,
        audio,
        aligned_segments: list,
        language: str,
        hf_token: str | None,
    ) -> list | None:
        """
        Runs pyannote diarization and assigns speaker labels to each segment.
        Returns [{speaker, start, end, text}] or None on failure.
        """
        if not hf_token:
            print(
                "DEBUG: [AI] Diarization skipped — no HuggingFace token provided.",
                file=sys.stderr,
            )
            return None

        try:
            diarize_model = whisperx.DiarizationPipeline(
                use_auth_token=hf_token, device=self.device
            )
            diarize_segments = diarize_model(audio)
            result = whisperx.assign_word_speakers(diarize_segments, {"segments": aligned_segments})
            segments = result.get("segments", aligned_segments)

            return [
                {
                    "speaker": seg.get("speaker", "Speaker 1"),
                    "start": round(seg.get("start", 0), 2),
                    "end": round(seg.get("end", 0), 2),
                    "text": seg.get("text", "").strip(),
                }
                for seg in segments
                if seg.get("text", "").strip()
            ]
        except Exception as e:
            print(f"DEBUG: [AI Diarization Error] {e}", file=sys.stderr)
            return None

    @staticmethod
    def _error(msg: str) -> dict:
        error_msg = f"[Transcription Error: {msg}]"
        print(f"DEBUG: {error_msg}", file=sys.stderr)
        return {"text": error_msg, "segments": None, "diarized": False}