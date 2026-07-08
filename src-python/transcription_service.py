# src-python/transcription_service.py
import sys
import os
import traceback
import torch
import whisperx
from config import DEFAULTS
from schemas import SCHEMA_VERSION, TranscriptSegment, TranscriptWord

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
        if os.environ.get("IS_TESTING") == "1":
            from unittest.mock import MagicMock
            print("DEBUG: [AI] Mocking WhisperX model for testing.", file=sys.stderr)
            self.device = "cpu"
            self.compute_type = "int8"
            self.model = MagicMock()
            self.model.transcribe.return_value = {"segments": [{"text": "Mocked test transcription text."}]}
            return

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

        self.model_name = os.environ.get("AI_NOTETAKING_WHISPER_MODEL") or DEFAULTS["whisper_model"]
        print(
            f"DEBUG: [AI] Carregando modelo WhisperX '{self.model_name}' via "
            f"{self.device.upper()} usando {self.compute_type}...",
            file=sys.stderr,
        )

        # Determine download root for PyInstaller bundling
        download_root = None
        if hasattr(sys, '_MEIPASS'):
            bundled_dir = os.path.join(sys._MEIPASS, 'models', 'whisper')
            if os.path.exists(bundled_dir):
                download_root = bundled_dir
                print(f"DEBUG: [AI] Using bundled Whisper model from {download_root}", file=sys.stderr)

        try:
            self.model = whisperx.load_model(
                self.model_name,
                self.device,
                compute_type=self.compute_type,
                download_root=download_root,
            )
        except Exception as e:
            print(
                f"DEBUG: [AI Error] Falha na GPU: {str(e)}.\n"
                f"{traceback.format_exc()}Tentando fallback para CPU...",
                file=sys.stderr,
            )
            try:
                self.device = "cpu"
                self.compute_type = "int8"
                self.model = whisperx.load_model(
                    self.model_name,
                    self.device,
                    compute_type=self.compute_type,
                    download_root=download_root,
                )
            except Exception as fallback_error:
                print(
                    f"DEBUG: [AI Critical Error] Falha total: {str(fallback_error)}.\n"
                    f"{traceback.format_exc()}",
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
            "ok": bool,
            "text": str,                     # plain joined text (always present)
            "segments": list | None,         # [{speaker, start, end, text}] or None
            "diarized": bool,
            "warnings": list[str],
            "error": {"code": str, "message": str} | None,
            "schema_version": int,
          }
        """
        if self.model is None:
            return self._error("MODEL_NOT_LOADED", "WhisperX model not loaded")

        if not os.path.exists(audio_path):
            return self._error("AUDIO_FILE_NOT_FOUND", f"audio file not found at {audio_path}")

        if os.path.getsize(audio_path) < 1024:
            return self._error(
                "AUDIO_FILE_EMPTY",
                "audio file is empty - recording may have been too short",
            )

        print(f"DEBUG: [AI] Transcribing: {audio_path}", file=sys.stderr)
        warnings = []

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
                warnings.append(f"Alignment skipped: {align_err}")
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
                    normalized_segments = self._normalize_segments(diarized_segments)
                    print("DEBUG: [AI] Diarization completed.", file=sys.stderr)
                    return {
                        "ok": True,
                        "text": plain_text,
                        "segments": normalized_segments,
                        "diarized": True,
                        "language": detected_language,
                        "warnings": warnings,
                        "error": None,
                        "schema_version": SCHEMA_VERSION,
                    }
                # Diarization failed — fall through to plain text
                warnings.append("Speaker diarization failed; plain transcription was returned.")
                print(
                    "DEBUG: [AI] Diarization failed, falling back to plain text.",
                    file=sys.stderr,
                )

            print("DEBUG: [AI] Transcription completed successfully.", file=sys.stderr)
            return {
                "ok": True,
                "text": plain_text,
                "segments": self._normalize_segments(segments),
                "diarized": False,
                "language": detected_language,
                "warnings": warnings,
                "error": None,
                "schema_version": SCHEMA_VERSION,
            }

        except Exception as e:
            return self._error("TRANSCRIPTION_FAILED", str(e))

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
            return result.get("segments", aligned_segments)
        except Exception as e:
            print(f"DEBUG: [AI Diarization Error] {e}", file=sys.stderr)
            return None

    @staticmethod
    def _normalize_segments(segments: list) -> list[dict]:
        normalized = []
        for index, segment in enumerate(segments):
            text = segment.get("text", "").strip()
            if not text:
                continue

            words = []
            for word in segment.get("words", []) or []:
                word_text = (word.get("word") or word.get("text") or "").strip()
                if not word_text:
                    continue
                words.append(
                    TranscriptWord(
                        text=word_text,
                        start_ms=TranscriptionService._seconds_to_ms(word.get("start")),
                        end_ms=TranscriptionService._seconds_to_ms(word.get("end")),
                        confidence=TranscriptionService._confidence(word),
                    )
                )

            start_ms = TranscriptionService._seconds_to_ms(segment.get("start")) or 0
            end_ms = TranscriptionService._seconds_to_ms(segment.get("end"))
            if end_ms is None:
                end_ms = start_ms

            normalized.append(
                TranscriptSegment(
                    segment_id=f"seg_{index:06d}",
                    speaker_id=segment.get("speaker"),
                    start_ms=start_ms,
                    end_ms=end_ms,
                    text=text,
                    confidence=TranscriptionService._confidence(segment),
                    words=words,
                ).model_dump()
            )
        return normalized

    @staticmethod
    def _seconds_to_ms(value) -> int | None:
        if value is None:
            return None
        return max(0, round(float(value) * 1000))

    @staticmethod
    def _confidence(item: dict) -> float | None:
        value = item.get("score", item.get("confidence"))
        if value is None:
            return None
        return max(0.0, min(1.0, float(value)))

    @staticmethod
    def _error(code: str, message: str) -> dict:
        print(f"DEBUG: [Transcription Error: {code}] {message}", file=sys.stderr)
        return {
            "ok": False,
            "text": "",
            "segments": None,
            "diarized": False,
            "warnings": [],
            "error": {"code": code, "message": message},
            "schema_version": SCHEMA_VERSION,
        }
