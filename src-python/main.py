# src-python/main.py
import sys
import json
import time
from audio_capture import AudioCaptureFactory

def send_event(event_type: str, payload: dict):
    """
    Observer Pattern: Emits events for Rust/Tauri to capture.
    """
    message = {"event": event_type, "data": payload}
    print(json.dumps(message))
    sys.stdout.flush()

def main():
    send_event("SYSTEM_READY", {"status": "Python engine is ready and listening."})

    # Instantiate the correct audio strategy for the current OS
    try:
        audio_capturer = AudioCaptureFactory.get_strategy()
    except Exception as e:
        send_event("ERROR", {"message": str(e)})
        return

    for line in sys.stdin:
        try:
            command = json.loads(line.strip())
            action = command.get("action")

            if action == "START_RECORDING":
                send_event("RECORDING_STATUS", {"is_recording": True})
                
                # Using our Strategy Pattern
                audio_capturer.start_recording()
                
                # Simulating VAD for now
                time.sleep(2)
                send_event("VAD_SPEECH_DETECTED", {"confidence": 0.98})

            elif action == "STOP_RECORDING":
                send_event("RECORDING_STATUS", {"is_recording": False})
                
                # Stop recording and get the file path
                saved_file_path = audio_capturer.stop_recording()
                send_event("PIPELINE_STATUS", {"step": "transcribing", "file": saved_file_path})

        except json.JSONDecodeError:
            send_event("ERROR", {"message": "Invalid JSON command received."})
        except Exception as e:
            send_event("ERROR", {"message": f"Unexpected error: {str(e)}"})

if __name__ == "__main__":
    main()