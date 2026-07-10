// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { getAudioInputState } from "@features/recording/hooks/useRecording";

export function AudioInputMeter({
  audioLevel,
  compact = false,
}: {
  audioLevel: number;
  compact?: boolean;
}) {
  const inputState = getAudioInputState(audioLevel);
  const width = `${Math.min(100, Math.max(0, audioLevel * 100))}%`;

  return (
    <div
      className={`audio-input-meter ${compact ? "compact" : ""} ${inputState.state}`}
      role="status"
      aria-label={inputState.label}
    >
      <div className="audio-input-track">
        <div className="audio-input-bar" style={{ width }} />
      </div>
      <span className="audio-input-label">{inputState.label}</span>
    </div>
  );
}