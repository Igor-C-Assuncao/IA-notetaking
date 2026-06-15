# src-python/tests/test_wasapi_loopback.py
import time
import os
import sys
import wave

# Ensure root import works
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from audio_capture import WindowsAudioCapture

def run_manual_wasapi_test():
    print("=====================================================================")
    print("WASAPI Loopback and Mic Sync Test Script")
    print("Please play a video or music in the background before starting!")
    print("=====================================================================")
    
    capture = WindowsAudioCapture()
    
    print("\n[Step 1/3] Starting a 5-second synchronized capture...")
    capture.start_recording(telemetry_callback=lambda level: print(f"  Live Audio RMS: {level * 100:.1f}%", end="\r"), system_audio=True)
    
    time.sleep(5.0)
    
    print("\n\n[Step 2/3] Stopping capture & executing DSP pipelines...")
    output_path = capture.stop_recording()
    
    print(f"\n[Step 3/3] Analyzing the saved output: {output_path}")
    if not os.path.exists(output_path):
        print("[FAILED] Output WAV file was not created!")
        sys.exit(1)
        
    with wave.open(output_path, "rb") as wf:
        ch = wf.getnchannels()
        sr = wf.getframerate()
        sz = wf.getsampwidth()
        frames = wf.getnframes()
        duration = frames / sr
        
        print("\nWAV Properties:")
        print(f"  - Channels: {ch} (Expected: 1 - Mono)")
        print(f"  - Sample Rate: {sr}Hz (Expected: 16000Hz)")
        print(f"  - Bit Depth: {sz * 8}-bit (Expected: 16-bit)")
        print(f"  - Duration: {duration:.2f} seconds")
        
        if ch != 1 or sr != 16000 or sz != 2:
            print("[FAILED] WAV properties do not match core requirements!")
            sys.exit(1)
            
        print("\n[SUCCESS] WASAPI capture properties and DSP paths verified!")
        print("=====================================================================")

if __name__ == "__main__":
    run_manual_wasapi_test()
