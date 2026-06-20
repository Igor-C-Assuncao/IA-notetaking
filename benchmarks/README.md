# Quality Benchmarks

This directory contains benchmark configuration, preparation scripts, scorers, and report conventions for the meeting intelligence pipeline.

## Directory Layout

```text
benchmarks/
  datasets/          Local prepared dataset manifests and metadata
  private/           Private benchmark paths or encrypted metadata
  reports/           Generated machine and human evaluation results
  scorers/           Metric implementations
  scripts/           Dataset download and preparation tools
  manifest.json      Pinned public fixture IDs, checksums, and licenses
  config.yaml        Benchmark weights and release thresholds
  run_benchmark.py   Benchmark entry point
```

Large audio files, private meetings, cached model responses, and generated reports must not be committed.

## Run

Prepare a JSON file using `datasets/example_fixture.json` as the contract, then run the scorer-only path:

```powershell
src-python\.venv\Scripts\python.exe benchmarks\run_benchmark.py `
  --input benchmarks\datasets\example_fixture.json
```

To generate prediction artifacts before scoring, use:

```powershell
src-python\.venv\Scripts\python.exe benchmarks\run_benchmark.py `
  --input benchmarks\datasets\example_fixture.json `
  --generate-predictions `
  --prediction-mode mock
```

`--prediction-mode mock` is deterministic and CI-safe. It copies `mock_predicted`,
`predicted`, or reference fields into a prediction artifact so the report pipeline
can be tested end to end without model downloads or network calls.

For local full-pipeline baselines against a configured provider:

```powershell
src-python\.venv\Scripts\python.exe benchmarks\run_benchmark.py `
  --input benchmarks\private\local_baseline.json `
  --generate-predictions `
  --prediction-mode llm `
  --provider ollama `
  --model llama3
```

Fixtures can provide either `input.transcript` or `input.audio_path`. Audio
fixtures run transcription before summarization; transcript fixtures skip
transcription and benchmark the meeting-intelligence stage.

The command exits with `0` when every configured release gate passes and `2` when a gate fails.
The printed path is the generated result folder.

## Result Storage

Generated results belong in `benchmarks/reports/`.

Recommended structure:

```text
benchmarks/reports/
  2026-06-11_<git-sha>/
    run.json
    summary.md
    transcription.json
    diarization.json
    meeting-intelligence.json
    performance.json
    human-review.json
```

Each run must record:

- Git commit
- Application and schema version
- Dataset fixture IDs and checksums
- Model and provider versions
- Prompt version
- Inference configuration
- Operating system and hardware
- Start/end timestamps
- Weighted overall score

Keep an approved compact baseline under version control only after removing private content and large generated artifacts.
