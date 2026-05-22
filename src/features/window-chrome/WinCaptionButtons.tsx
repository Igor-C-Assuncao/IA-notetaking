import { useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function WinCaptionButtons({ isLG, compactExpand }: { isLG: boolean; compactExpand?: () => void }) {
  const win = getCurrentWindow();
  const fg = isLG ? "rgba(255,255,255,0.85)" : "#1a1814";
  const hoverBg = isLG ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.07)";

  return (
    <div className="win-caption-buttons">
      <WinBtn fg={fg} hoverBg={hoverBg} onClick={() => win.minimize()} title="Minimize">
        <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1}>
          <path d="M0 5h10" />
        </svg>
      </WinBtn>
      {/* In compact mode, the "maximize" button expands to the full view instead
          of the native maximize (which makes no sense on a 120px pill). */}
      <WinBtn
        fg={fg}
        hoverBg={hoverBg}
        onClick={compactExpand ?? (() => win.toggleMaximize())}
        title={compactExpand ? "Expand" : "Maximize"}
      >
        <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1}>
          <rect x="0.5" y="0.5" width="9" height="9" />
        </svg>
      </WinBtn>
      <WinBtn fg={fg} hoverBg="#e81123" hoverFg="#fff" onClick={() => win.close()} title="Close">
        <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1}>
          <path d="M0 0l10 10M10 0L0 10" />
        </svg>
      </WinBtn>
    </div>
  );
}

function WinBtn({
  children, fg, hoverBg, hoverFg, onClick, title,
}: {
  children: React.ReactNode; fg: string; hoverBg: string; hoverFg?: string;
  onClick: () => void; title?: string;
}) {
  const [h, setH] = useState(false);
  return (
    <button
      className="win-btn"
      title={title}
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        background: h ? hoverBg : "transparent",
        color: h && hoverFg ? hoverFg : fg,
      }}
    >
      {children}
    </button>
  );
}
