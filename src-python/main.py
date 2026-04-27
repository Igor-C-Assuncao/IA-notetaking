# src-python/main.py
import sys
import json
import time

# Internal services
from audio_capture import AudioCaptureFactory, list_audio_devices
from transcription_service import TranscriptionService
from llm_service import LLMFactory

def send_event(event_type: str, payload: dict):
    """
    Observer Pattern: Emits events for Rust/Tauri to capture via stdout.
    """
    message = {"event": event_type, "data": payload}
    print(json.dumps(message))
    sys.stdout.flush()

def main():
    # Allow React time to mount and start listening to IPC events
    time.sleep(2)
    send_event("SYSTEM_READY", {"status": "Python engine is ready and listening."})
    send_event("DEVICE_LIST", {"devices": list_audio_devices()})

    # 1. Initialize Audio Capture
    try:
        audio_capturer = AudioCaptureFactory.get_strategy()
    except Exception as e:
        send_event("ERROR", {"message": f"Audio Error: {str(e)}"})
        return

    # 2. Initialize AI Transcriber (WhisperX)
    try:
        transcriber = TranscriptionService()
    except Exception as e:
        send_event("ERROR", {"message": f"Failed to initialize WhisperX: {str(e)}"})
        transcriber = None

    # Main loop listening for IPC commands from Rust
    for line in sys.stdin:
        try:
            command = json.loads(line.strip())
            action = command.get("action")

            if action == "LIST_DEVICES":
                send_event("DEVICE_LIST", {"devices": list_audio_devices()})

            elif action == "START_RECORDING":
                send_event("RECORDING_STATUS", {"is_recording": True})

                # Store recording config for use when STOP_RECORDING arrives
                current_config = {
                    "system_audio": command.get("system_audio", False),
                    "auto_summarize": command.get("auto_summarize", True),
                    "speaker_diarization": command.get("speaker_diarization", False),
                    "language": command.get("language", "auto"),
                    "system_prompt": command.get("system_prompt", ""),
                    "llm_provider": command.get("llm_provider", "ollama"),
                    "llm_model": command.get("llm_model", "llama3"),
                    "api_key": command.get("api_key", ""),
                }

                def on_telemetry(level: float):
                    send_event("VAD_TELEMETRY", {"level": round(level, 3)})

                audio_capturer.start_recording(telemetry_callback=on_telemetry)

            elif action == "PAUSE_RECORDING":
                if hasattr(audio_capturer, 'pause_recording'):
                    audio_capturer.pause_recording()
                send_event("RECORDING_STATUS", {"is_recording": True, "is_paused": True})

            elif action == "RESUME_RECORDING":
                if hasattr(audio_capturer, 'resume_recording'):
                    audio_capturer.resume_recording()
                send_event("RECORDING_STATUS", {"is_recording": True, "is_paused": False})
                send_event("RECORDING_STATUS", {"is_recording": False})
                send_event("PIPELINE_STATUS", {"step": "Processing Audio (VAD)..."})

                # STEP A: Stop recording and trim silence
                saved_file_path = audio_capturer.stop_recording()

                # STEP B: Transcribe audio
                if transcriber:
                    send_event("PIPELINE_STATUS", {"step": "Transcribing with WhisperX..."})
                    lang = current_config.get("language", "auto")
                    transcription_result = transcriber.transcribe(
                        saved_file_path,
                        language=None if lang == "auto" else lang
                    )
                    send_event("TRANSCRIPTION_COMPLETED", {
                        "text": transcription_result["text"],
                        "segments": transcription_result.get("segments"),
                        "diarized": transcription_result.get("diarized", False),
                    })

                    # STEP C: Generate Notes — only if auto_summarize is enabled
                    if not current_config.get("auto_summarize", True):
                        send_event("PIPELINE_STATUS", {"step": "Done."})
                        continue

                    send_event("PIPELINE_STATUS", {"step": "Generating Notes with AI..."})

                    provider_name = current_config.get("llm_provider", "ollama")
                    model_name = current_config.get("llm_model", "llama3")
                    api_key = current_config.get("api_key", "")
                    
                    try:
                        llm = LLMFactory.get_provider(provider_name, model_name)
                        result = llm.generate_notes(
                            transcription_result["text"],
                            api_key=api_key,
                            system_prompt=current_config.get("system_prompt", "") or None,
                        )

                        # Filter out placeholder action items some models return
                        _NULL_ACTIONS = {"none identified.", "none.", "none", "n/a", "n/a."}
                        structured = result.get("structured", {})
                        if "actions" in structured:
                            structured["actions"] = [
                                a for a in structured["actions"]
                                if a.get("text", "").strip().lower() not in _NULL_ACTIONS
                            ]

                        send_event("NOTES_GENERATED", {
                            "markdown": result.get("markdown", ""),
                            "structured": structured,
                        })
                        send_event("PIPELINE_STATUS", {"step": "Done."})
                    except Exception as e:
                        send_event("ERROR", {"message": f"LLM Generation Error: {str(e)}"})
                else:
                    send_event("ERROR", {"message": "Transcriber is offline."})

        except json.JSONDecodeError:
            send_event("ERROR", {"message": "Invalid JSON command received."})
        except Exception as e:
            send_event("ERROR", {"message": f"Unexpected error: {str(e)}"})

if __name__ == "__main__":
    main()