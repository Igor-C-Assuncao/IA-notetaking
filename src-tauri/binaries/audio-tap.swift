// audio-tap.swift
// Captures system audio via Core Audio Tap (macOS 14.4+) and writes
// raw PCM (Float32 interleaved stereo, 48kHz) to stdout.
// Python reads chunks from the process stdout and normalizes before mixing.
//
// Build (run from src-tauri/binaries/):
//   swiftc audio-tap.swift -o audio-tap-aarch64-apple-darwin   # Apple Silicon
//   swiftc audio-tap.swift -o audio-tap-x86_64-apple-darwin    # Intel
//
// Send "stop\n" to stdin to terminate cleanly.

import AudioToolbox
import AVFoundation
import Foundation

let kSampleRate: Double = 48000
let kChannels: UInt32 = 2

var tapRef: AudioObjectID = kAudioObjectUnknown
var aggDevRef: AudioObjectID = kAudioObjectUnknown

func writePCM(_ buffer: AVAudioPCMBuffer) {
    guard let channelData = buffer.floatChannelData else { return }
    let frameCount = Int(buffer.frameLength)
    let channelCount = Int(buffer.format.channelCount)
    var interleaved = [Float32](repeating: 0, count: frameCount * channelCount)
    for frame in 0..<frameCount {
        for ch in 0..<channelCount {
            interleaved[frame * channelCount + ch] = channelData[ch][frame]
        }
    }
    interleaved.withUnsafeBytes { ptr in
        _ = ptr.baseAddress.map {
            FileHandle.standardOutput.write(Data($0, count: ptr.count))
        }
    }
}

if #available(macOS 14.4, *) {
    var tapDesc = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
    tapDesc.mutedWhenTapped = false

    var err = AudioHardwareCreateProcessTap(&tapDesc, &tapRef)
    guard err == noErr else {
        fputs("ERROR: AudioHardwareCreateProcessTap \(err)\n", stderr)
        exit(1)
    }

    let aggDesc: [String: Any] = [
        kAudioAggregateDeviceNameKey: "AI NoteTaking Tap",
        kAudioAggregateDeviceUIDKey: "com.opensource.ainotetaker.catap",
        kAudioAggregateDeviceIsPrivateKey: 1,
        kAudioAggregateDeviceIsStackedKey: 0,
        kAudioAggregateDeviceTapListKey: [["uid": tapRef]],
    ]
    err = AudioHardwareCreateAggregateDevice(aggDesc as CFDictionary, &aggDevRef)
    guard err == noErr else {
        fputs("ERROR: AudioHardwareCreateAggregateDevice \(err)\n", stderr)
        exit(1)
    }

    let engine = AVAudioEngine()
    let format = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: kSampleRate,
        channels: kChannels,
        interleaved: true
    )!

    engine.inputNode.installTap(onBus: 0, bufferSize: 4096, format: format) { buf, _ in
        writePCM(buf)
    }

    do {
        try engine.start()
        fputs("READY\n", stderr)
    } catch {
        fputs("ERROR: engine start \(error)\n", stderr)
        exit(1)
    }

    // Block until "stop" arrives on stdin
    while let line = readLine() {
        if line.trimmingCharacters(in: .whitespaces) == "stop" { break }
    }

    engine.stop()
    engine.inputNode.removeTap(onBus: 0)
    AudioHardwareDestroyAggregateDevice(aggDevRef)
    AudioHardwareDestroyProcessTap(tapRef)

} else {
    // Signal Python to fall back to ScreenCaptureKit path
    fputs("FALLBACK_SCKIT\n", stderr)
    exit(2)
}