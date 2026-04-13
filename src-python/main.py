# src-python/main.py
import sys
import json
import time
from audio_capture import AudioCaptureFactory

def send_event(event_type: str, payload: dict):
    """
    Observer Pattern: Emits events for Rust/Tauri to capture via stdout.
    """
    message = {"event": event_type, "data": payload}
    print(json.dumps(message))
    sys.stdout.flush()

def main():
    time.sleep(2)
    send_event("SYSTEM_READY", {"status": "Python engine is ready and listening."})

    try:
        audio_capturer = AudioCaptureFactory.get_strategy()
    except Exception as e:
        send_event("ERROR", {"message": str(e)})
        return

    # PRE-LOAD AI MODELS: Initialize the transcriber so it's ready in memory
    try:
        from transcription_service import TranscriptionService
        transcriber = TranscriptionService()
    except Exception as e:
        send_event("ERROR", {"message": f"Failed to initialize AI: {str(e)}"})
        transcriber = None

    for line in sys.stdin:
        try:
            command = json.loads(line.strip())
            action = command.get("action")

            if action == "START_RECORDING":
                send_event("RECORDING_STATUS", {"is_recording": True})
                audio_capturer.start_recording()
                
            elif action == "STOP_RECORDING":
                send_event("RECORDING_STATUS", {"is_recording": False})
                send_event("PIPELINE_STATUS", {"step": "Processing Audio..."})
                
                # 1. Stop recording and run VAD
                saved_file_path = audio_capturer.stop_recording()
                
                # 2. Run Transcription
                if transcriber:
                    send_event("PIPELINE_STATUS", {"step": "Transcribing with WhisperX..."})
                    transcription_result = transcriber.transcribe(saved_file_path)
                    
                    # 3. Send final text back to React
                    send_event("TRANSCRIPTION_COMPLETED", {"text": transcription_result})
                else:
                    send_event("ERROR", {"message": "Transcriber is offline."})

        except json.JSONDecodeError:
            send_event("ERROR", {"message": "Invalid JSON command received."})
        except Exception as e:
            send_event("ERROR", {"message": f"Unexpected error: {str(e)}"})

if __name__ == "__main__":
    main()