// audio-tap.swift
// Captures system audio via Core Audio Tap (macOS 14.4+).
// Writes raw PCM (Float32 interleaved stereo, 48kHz) to stdout.
// Send "stop\n" to stdin to terminate cleanly.

import AudioToolbox
import AVFoundation
import Foundation

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
        FileHandle.standardOutput.write(Data(bytes: ptr.baseAddress!, count: ptr.count))
    }
}

if #available(macOS 14.4, *) {
    let tapDesc = CATapDescription(stereoMixdownOfProcesses: [])

    var err = AudioHardwareCreateProcessTap(tapDesc, &tapRef)
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
    let inputNode = engine.inputNode

    // Use nil format — let the engine use its native format for the tap.
    // We convert to Float32 stereo 48kHz using AVAudioConverter below.
    let nativeFormat = inputNode.inputFormat(forBus: 0)
    fputs("DEBUG: native format = \(nativeFormat)\n", stderr)

    // Target format: Float32 non-interleaved stereo 48kHz (AVAudioEngine standard)
    guard let targetFormat = AVAudioFormat(
        commonFormat: .pcmFormatFloat32,
        sampleRate: 48000,
        channels: 2,
        interleaved: false
    ) else {
        fputs("ERROR: could not create target format\n", stderr)
        exit(1)
    }

    guard let converter = AVAudioConverter(from: nativeFormat, to: targetFormat) else {
        fputs("ERROR: could not create AVAudioConverter\n", stderr)
        exit(1)
    }

    inputNode.installTap(onBus: 0, bufferSize: 4096, format: nativeFormat) { inBuf, _ in
        let frameCapacity = AVAudioFrameCount(
            Double(inBuf.frameLength) * targetFormat.sampleRate / nativeFormat.sampleRate
        ) + 1

        guard let outBuf = AVAudioPCMBuffer(
            pcmFormat: targetFormat,
            frameCapacity: frameCapacity
        ) else { return }

        var error: NSError?
        converter.convert(to: outBuf, error: &error) { _, outStatus in
            outStatus.pointee = .haveData
            return inBuf
        }

        if error == nil && outBuf.frameLength > 0 {
            writePCM(outBuf)
        }
    }

    do {
        try engine.start()
        fputs("READY\n", stderr)
    } catch {
        fputs("ERROR: engine start \(error)\n", stderr)
        exit(1)
    }

    while let line = readLine() {
        if line.trimmingCharacters(in: .whitespaces) == "stop" { break }
    }

    engine.stop()
    inputNode.removeTap(onBus: 0)
    AudioHardwareDestroyAggregateDevice(aggDevRef)
    AudioHardwareDestroyProcessTap(tapRef)

} else {
    fputs("FALLBACK_SCKIT\n", stderr)
    exit(2)
}