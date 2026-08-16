# v0.3.2 release checklist

Attach a completed copy of this checklist to the draft release before requesting approval from the `v0.3.2-production` GitHub Environment.

- [ ] Windows clean machine — CPU engine download, short recording, transcription, compact widget at 400 × 120.
- [ ] Windows clean machine — compatible NVIDIA GPU engine and `--self-test`.
- [ ] Windows without NVIDIA — GPU warning shown; CPU recommendation works.
- [ ] Apple Silicon with macOS 14.4+ — `.app` sidecars are arm64, executable, and `--self-test` passes.
- [ ] Interrupt networking and restart the app near 30% and 70%; download resumes.
- [ ] Switch repeatedly to Chrome during download; the app remains responsive.
- [ ] Ollama states verified: offline, ready, loading model, generating, completed, and failed.
- [ ] Diagnostics contain no audio, transcript, prompt, meeting summary, token, or API key.
- [ ] DMG verifies and opens; MSI installs silently and contains the expected payload.
- [ ] CPU, GPU, macOS, DMG, MSI, and EXE smoke jobs are green in the same workflow run.
