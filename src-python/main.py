# src-python/main.py
import sys
import json
import time

def send_event(event_type: str, payload: dict):
    """
    Observer Pattern: Emits events for Rust/Tauri to capture.
    """
    message = {"event": event_type, "data": payload}
    # Print as a JSON string to stdout
    print(json.dumps(message))
    # CRITICAL: Flush forces the system to send the data immediately
    sys.stdout.flush()

def main():
    # Signal that the engine started successfully
    send_event("SYSTEM_READY", {"status": "Python engine is ready and listening."})

    # Main loop: listens for commands from Rust via stdin
    for line in sys.stdin:
        try:
            command = json.loads(line.strip())
            action = command.get("action")

            if action == "START_RECORDING":
                send_event("RECORDING_STATUS", {"is_recording": True})
                # Simulating Voice Activity Detection (VAD) for testing the bridge
                time.sleep(2)
                send_event("VAD_SPEECH_DETECTED", {"confidence": 0.98})

            elif action == "STOP_RECORDING":
                send_event("RECORDING_STATUS", {"is_recording": False})
                send_event("PIPELINE_STATUS", {"step": "transcribing"})

        except json.JSONDecodeError:
            send_event("ERROR", {"message": "Invalid JSON command received."})

if __name__ == "__main__":
    main()