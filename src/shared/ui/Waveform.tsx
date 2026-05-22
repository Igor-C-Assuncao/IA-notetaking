import { useMemo } from "react";

export function Waveform({
  bars = 24, color = "#fff", active = true, height = 22, width = 160, opacity = 0.9,
}: {
  bars?: number; color?: string; active?: boolean; height?: number; width?: number; opacity?: number;
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
  return (
    <div style={{ display: "flex", alignItems: "center", gap, height, width, opacity: active ? opacity : 0.3, flexShrink: 0 }}>
      {seeds.map((s, i) => (
        <div
          key={i}
          style={{
            flex: 1, background: color, borderRadius: 99,
            height: `${s.h * 100}%`, minHeight: 2,
            animation: active ? `wf ${900 + (s.d % 600)}ms ease-in-out ${s.d}ms infinite alternate` : "none",
          }}
        />
      ))}
    </div>
  );
}
