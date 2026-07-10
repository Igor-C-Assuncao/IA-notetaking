// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
export function StatusDot({ isRecording, size = 8, isLG }: { isRecording: boolean; size?: number; isLG: boolean }) {
  const color = isRecording ? (isLG ? "#ff4d5f" : "#c03838") : (isLG ? "#30d158" : "#2d5a3d");
  return (
    <span style={{ position: "relative", display: "inline-flex", width: size, height: size, flexShrink: 0 }}>
      <span style={{
        position: "absolute", inset: 0, borderRadius: 99, background: color,
        boxShadow: isLG ? `0 0 8px ${color}` : "none",
      }} />
      {isRecording && (
        <span style={{
          position: "absolute", inset: -2, borderRadius: 99, background: color,
          opacity: 0.35, animation: "dotPulse 1.6s ease-in-out infinite",
        }} />
      )}
    </span>
  );
}
