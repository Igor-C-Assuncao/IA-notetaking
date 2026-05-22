import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function MacTrafficLights({ theme }: { theme: string }) {
  const [hover, setHover] = useState(false);
  const win = getCurrentWindow();
  const isNB = theme === "minimalist-notebook";

  return (
    <div
      className="mac-traffic-lights"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        className="tl tl-red"
        onClick={() => win.close()}
        title="Close"
        style={{ border: isNB ? "1px solid #1a1814" : "0.5px solid rgba(0,0,0,0.2)" }}
      >
        {hover && (
          <svg width={8} height={8} viewBox="0 0 14 14" fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={1.6} strokeLinecap="round">
            <path d="M4 4l6 6M10 4l-6 6" />
          </svg>
        )}
      </button>
      <button
        className="tl tl-amber"
        onClick={() => win.minimize()}
        title="Minimize"
        style={{ border: isNB ? "1px solid #1a1814" : "0.5px solid rgba(0,0,0,0.2)" }}
      >
        {hover && (
          <svg width={8} height={8} viewBox="0 0 14 14" fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={1.6} strokeLinecap="round">
            <path d="M3 7h8" />
          </svg>
        )}
      </button>
      <button
        className="tl tl-green"
        onClick={() => win.toggleMaximize()}
        title="Maximize"
        style={{ border: isNB ? "1px solid #1a1814" : "0.5px solid rgba(0,0,0,0.2)" }}
      >
        {hover && (
          <svg width={8} height={8} viewBox="0 0 14 14" fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={1.6} strokeLinecap="round">
            <path d="M4 4h6v6" /><path d="M10 10H4V4" transform="rotate(180 7 7)" />
          </svg>
        )}
      </button>
    </div>
  );
}
