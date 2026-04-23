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

                def on_telemetry(level: float):
                    send_event("VAD_TELEMETRY", {"level": round(level, 3)})

                audio_capturer.start_recording(telemetry_callback=on_telemetry)
                
            elif action == "STOP_RECORDING":
                send_event("RECORDING_STATUS", {"is_recording": False})
                send_event("PIPELINE_STATUS", {"step": "Processing Audio (VAD)..."})
                
                # STEP A: Stop recording and trim silence
                saved_file_path = audio_capturer.stop_recording()
                
                # STEP B: Transcribe audio
                if transcriber:
                    send_event("PIPELINE_STATUS", {"step": "Transcribing with WhisperX..."})
                    transcription_result = transcriber.transcribe(saved_file_path)
                    
                    # Emit raw transcription so the UI can show it immediately
                    send_event("TRANSCRIPTION_COMPLETED", {"text": transcription_result})
                    
                    # STEP C: Generate Structured Notes
                    send_event("PIPELINE_STATUS", {"step": "Generating Notes with AI..."})
                    
                    # Extract LLM config from React command (Default to local Ollama)
                    provider_name = command.get("llm_provider", "ollama")
                    model_name = command.get("llm_model", "llama3")
                    api_key = command.get("api_key", "")
                    
                    try:
                        llm = LLMFactory.get_provider(provider_name, model_name)
                        notes_markdown = llm.generate_notes(transcription_result, api_key)
                        
                        # Emit final structured notes
                        send_event("NOTES_GENERATED", {"markdown": notes_markdown})
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