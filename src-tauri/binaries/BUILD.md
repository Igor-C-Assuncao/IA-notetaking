# Building the audio-tap binary

The `audio-tap.swift` CLI captures system audio via Core Audio Tap (macOS 14.4+)
and pipes raw PCM to stdout. It must be compiled on macOS before running the app.

## Requirements

- macOS 14.4+ SDK (Xcode 15.3+)
- Swift compiler (`swiftc`) — included with Xcode Command Line Tools

## Build

Run from this directory (`src-tauri/binaries/`):

```bash
# Apple Silicon (M1/M2/M3/M4)
swiftc audio-tap.swift \
  -o audio-tap-aarch64-apple-darwin \
  -framework AudioToolbox \
  -framework AVFoundation \
  -framework Foundation \
  -target arm64-apple-macos14.4

# Intel
swiftc audio-tap.swift \
  -o audio-tap-x86_64-apple-darwin \
  -framework AudioToolbox \
  -framework AVFoundation \
  -framework Foundation \
  -target x86_64-apple-macos14.4

# Universal binary (both architectures)
lipo -create \
  audio-tap-aarch64-apple-darwin \
  audio-tap-x86_64-apple-darwin \
  -output audio-tap-universal-apple-darwin
```

## Verify

```bash
./audio-tap-aarch64-apple-darwin &
PID=$!
sleep 2
kill $PID
```

You should see `READY` on stderr if the build succeeded and the system allows it.

## Notes

- The binary is listed in `tauri.conf.json` under `bundle.externalBin` so Tauri
  includes it in the app bundle automatically.
- Tauri expects the binary at `src-tauri/binaries/audio-tap-{arch}-apple-darwin`.
  The arch string must match the output of `uname -m` on the build machine.
- No code signing is required for development (`npm run tauri dev`).
  For distribution builds, the binary must be signed with the same Developer ID
  as the app.
- On macOS < 14.4, the binary exits with code 2 and prints `FALLBACK_SCKIT`
  to stderr. Python detects this and falls back to mic-only capture gracefully.