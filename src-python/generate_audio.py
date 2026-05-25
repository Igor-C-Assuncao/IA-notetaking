import os
import wave
import struct
import math

def generate_fixture():
    fixtures_dir = os.path.join(os.path.dirname(__file__), "tests", "fixtures")
    os.makedirs(fixtures_dir, exist_ok=True)
    
    file_path = os.path.join(fixtures_dir, "sample_meeting_pt.wav")
    
    sample_rate = 16000
    duration_seconds = 10  # 10 seconds is plenty to verify pipeline and keeps size even smaller (~320KB)
    num_samples = sample_rate * duration_seconds
    
    # Standard 16-bit mono PCM wav settings
    num_channels = 1
    sample_width = 2  # 2 bytes = 16 bit
    
    print(f"Generating WAV fixture at: {file_path}")
    
    with wave.open(file_path, "wb") as wav_file:
        wav_file.setnchannels(num_channels)
        wav_file.setsampwidth(sample_width)
        wav_file.setframerate(sample_rate)
        
        # Write a simple 440Hz sine wave tone so there's actual signal for Whisper/VAD
        frequency = 440.0
        amplitude = 16000.0  # Safe volume level for 16-bit audio
        
        frames = []
        for i in range(num_samples):
            # Generate sine wave
            t = float(i) / sample_rate
            value = int(amplitude * math.sin(2 * math.pi * frequency * t))
            # Pack as 16-bit signed integer
            frame_data = struct.pack("<h", value)
            frames.append(frame_data)
            
        wav_file.writeframes(b"".join(frames))
        
    print("Fixture generated successfully!")

if __name__ == "__main__":
    generate_fixture()
