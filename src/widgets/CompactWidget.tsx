// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { invoke } from "@tauri-apps/api/core";
import { MacTrafficLights } from "@features/window-chrome/MacTrafficLights";
import { WinCaptionButtons } from "@features/window-chrome/WinCaptionButtons";
import { StatusDot } from "@shared/ui/StatusDot";
import { Waveform } from "@shared/ui/Waveform";
import { LogoMark } from "@shared/ui/LogoMark";
import { formatDuration } from "@shared/lib/formatDuration";
import { GearIcon, ArrowsOutSimpleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useSettings } from "@app/providers/SettingsProvider";
import { useTheme } from "@app/providers/ThemeProvider";
import { useRecording } from "@features/recording/hooks/useRecording";
import { detectOS } from "@shared/lib/detectOS";

export function CompactWidget({
  isTransitioning, toggleWindowMode
}: {
  isTransitioning: boolean; toggleWindowMode: () => void;
}) {
  const { settings } = useSettings();
  const { isLG, waveColor } = useTheme();
  const { isRecording, recordingSeconds, audioLevel, micLevel, systemLevel, transcriptionReady, toggleRecording } = useRecording();
  
  const isWin = detectOS() === "win";

  return (
    <div className={`compact-widget ${isWin ? "win" : "mac"} ${isTransitioning ? "transitioning" : "entered"}`}>
      <div className="compact-os-strip" data-tauri-drag-region>
        {!isWin && <MacTrafficLights theme={settings.theme} />}
        <div className="compact-os-title" data-tauri-drag-region>
          <LogoMark size={12} light={isLG} />
          <span>Ai NoteTaking</span>
        </div>
        {isWin && <WinCaptionButtons isLG={isLG} compactExpand={toggleWindowMode} />}
      </div>

      <div className="pill-inner">
        <div className="pill-left" data-tauri-drag-region>
          <StatusDot isRecording={isRecording} size={8} isLG={isLG} />
        </div>

        <div className="pill-middle" data-tauri-drag-region>
          <Waveform width={150} height={20} color={waveColor} active={isRecording} bars={28} level={audioLevel} micLevel={micLevel} systemLevel={systemLevel} />
          <span className="timer-display">
            {isRecording ? formatDuration(recordingSeconds) : "--:--"}
          </span>
        </div>

        <div className="pill-right">
          <button
            className={`icon-btn-pill ${isRecording && !settings.systemAudio ? "has-warning" : ""}`}
            onClick={() => invoke("open_popover_window")}
            title={isRecording && !settings.systemAudio ? "System audio is off. Remote meeting audio may not be captured." : "Settings"}
          >
            <GearIcon size={15} />
            {isRecording && !settings.systemAudio && <WarningCircleIcon className="compact-warning-icon" size={10} weight="fill" />}
          </button>
          <button
            className={`record-btn-pill ${isRecording ? "recording" : ""}`}
            onClick={toggleRecording}
            disabled={!isRecording && !transcriptionReady}
            title={isRecording ? "Stop Recording" : transcriptionReady ? "Start Recording" : "Whisper is still loading"}
            style={isRecording ? { transform: `scale(${1 + audioLevel * 0.12})`, transition: "transform 80ms ease-out" } : undefined}
          >
            {isRecording ? <span className="stop-square" /> : <span className="record-circle" />}
          </button>
          <button className="icon-btn-pill" onClick={toggleWindowMode} title="Expand">
            <ArrowsOutSimpleIcon size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
