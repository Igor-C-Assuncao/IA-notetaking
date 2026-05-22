const SHORTCUTS = [
  { keys: ["⌘", "⇧", "R"], win: ["Ctrl", "⇧", "R"], label: "Toggle recording" },
  { keys: ["⌘", "⇧", "P"], win: ["Ctrl", "⇧", "P"], label: "Pause / Resume" },
  { keys: ["⌘", "⇧", "E"], win: ["Ctrl", "⇧", "E"], label: "Expand / Collapse" },
  { keys: ["⌘", "⇧", ","], win: ["Ctrl", "⇧", ","], label: "Open settings" },
];

export function ShortcutsModal({ onClose, isLG }: { onClose: () => void; isLG: boolean }) {
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div
        className={`shortcuts-modal ${isLG ? "shortcuts-lg" : "shortcuts-nb"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcuts-header">
          <span className="shortcuts-title">Keyboard Shortcuts</span>
          <button className="shortcuts-close" onClick={onClose}>✕</button>
        </div>
        <div className="shortcuts-list">
          {SHORTCUTS.map((s, i) => (
            <div key={i} className="shortcut-row">
              <span className="shortcut-label">{s.label}</span>
              <span className="shortcut-keys">
                {(isMac ? s.keys : s.win).map((k, j) => (
                  <kbd key={j} className="shortcut-key">{k}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
        <div className="shortcuts-note">
          Global shortcuts work even when the app is not in focus.
        </div>
      </div>
    </div>
  );
}
