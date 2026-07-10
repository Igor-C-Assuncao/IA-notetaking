// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { useMemo } from "react";

export function Waveform({
  bars = 24,
  color = "#fff",
  systemColor = "rgba(135, 135, 135, 0.55)",
  active = true,
  height = 22,
  width = 160,
  opacity = 0.9,
  level,
  micLevel,
  systemLevel,
}: {
  bars?: number;
  color?: string;
  systemColor?: string;
  active?: boolean;
  height?: number;
  width?: number;
  opacity?: number;
  level?: number;
  micLevel?: number;
  systemLevel?: number;
}) {
  const seeds = useMemo(
    () =>
      Array.from({ length: bars }, (_, i) => ({
        h: 0.25 + ((Math.sin(i * 1.3) + Math.cos(i * 2.7)) * 0.5 + 0.5) * 0.75,
        d: (i * 53) % 900,
      })),
    [bars]
  );
  const gap = Math.max(1, width / bars / 3);
  const clampLevel = (value = 0) => Math.min(1, Math.max(0, value));
  const combinedLevel = clampLevel(level ?? Math.max(micLevel ?? 0, systemLevel ?? 0));
  const resolvedMicLevel = micLevel === undefined && systemLevel === undefined ? combinedLevel : clampLevel(micLevel);
  const resolvedSystemLevel = systemLevel === undefined ? 0 : clampLevel(systemLevel);
  const hasLayeredSources = micLevel !== undefined || systemLevel !== undefined;
  const intensityFor = (value: number) => Math.min(1, Math.max(0, value * 16));
  const barHeight = (seedHeight: number, sourceLevel: number) => `${Math.max(8, (0.12 + seedHeight * intensityFor(sourceLevel)) * 100)}%`;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap,
        height,
        width,
        opacity: active ? opacity : 0.3,
        flexShrink: 0,
      }}
    >
      {seeds.map((s, i) => {
        const animation = active ? `wf ${900 + (s.d % 600)}ms ease-in-out ${s.d}ms infinite alternate` : "none";
        return (
          <div key={i} style={{ position: "relative", flex: 1, alignSelf: "stretch", minWidth: 1, display: "flex", alignItems: "center" }}>
            {hasLayeredSources && (
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  margin: "auto",
                  background: systemColor,
                  borderRadius: 99,
                  height: barHeight(s.h, resolvedSystemLevel),
                  minHeight: 2,
                  animation,
                }}
              />
            )}
            <div
              style={{
                position: hasLayeredSources ? "absolute" : "static",
                left: hasLayeredSources ? "17%" : undefined,
                right: hasLayeredSources ? "17%" : undefined,
                bottom: hasLayeredSources ? 0 : undefined,
                margin: hasLayeredSources ? "auto" : undefined,
                width: hasLayeredSources ? "66%" : undefined,
                background: color,
                borderRadius: 99,
                height: barHeight(s.h, resolvedMicLevel),
                minHeight: 2,
                animation,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
