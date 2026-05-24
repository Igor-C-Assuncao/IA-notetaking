import React from "react";
import "./Toggle.css";

interface ToggleProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export function Toggle({ id, checked, onChange, disabled = false, label }: ToggleProps) {
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      onChange(!checked);
    }
  };

  return (
    <div className={`toggle-container ${disabled ? "disabled" : ""}`}>
      {label && <span className="toggle-label">{label}</span>}
      <div
        id={id}
        role="switch"
        aria-checked={checked}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && onChange(!checked)}
        onKeyDown={handleKeyDown}
        className={`toggle-track ${checked ? "checked" : ""}`}
      >
        <div className={`toggle-thumb ${checked ? "checked" : ""}`} />
      </div>
    </div>
  );
}
export default Toggle;
