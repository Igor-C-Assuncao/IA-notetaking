import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import { SettingsProvider, useSettings } from "@app/providers/SettingsProvider";
import { ThemeProvider } from "@app/providers/ThemeProvider";
import { IpcProvider, usePythonEvent } from "@app/providers/IpcProvider";

import { CompactWidget } from "@widgets/CompactWidget";
import { ExpandedView } from "@widgets/ExpandedView";
import { PopoverWidget } from "@widgets/PopoverWidget";

import { useWindowMode } from "@features/window-chrome/hooks/useWindowMode";
import { useRecording } from "@features/recording/hooks/useRecording";
import { OnboardingWizard } from "@features/onboarding/OnboardingWizard";
import { useTranscription } from "@features/transcription/hooks/useTranscription";
import { useMeetings } from "@features/meetings/hooks/useMeetings";

import "./App.css";

// App logic using hooks. Needs to be inside providers.
function MainApp() {
  const { isExpanded, isTransitioning, toggleWindowMode } = useWindowMode();
  const { settings } = useSettings();
  const { isRecording, toggleRecording } = useRecording();
  const { transcription } = useTranscription();
  const { loadHistory } = useMeetings();
  const [isPaused, setIsPaused] = useState(false);
  const win = getCurrentWindow();

  usePythonEvent("NOTES_GENERATED", async (data) => {
    if (!transcription) return;
    try {
      const now = new Date();
      const dateStr = now.toISOString().slice(0, 19).replace('T', ' ');
      const titleStr = `Meeting on ${now.toLocaleDateString()}`;
      
      const speakers = data.structured?.speakers ? JSON.stringify(data.structured.speakers) : null;
      const tags = data.structured?.tags ? JSON.stringify(data.structured.tags) : null;
      const structuredStr = JSON.stringify(data.structured);
      
      const meetingId = await invoke<number>("save_meeting", {
        date: dateStr,
        title: titleStr,
        raw_transcript: transcription,
        markdown_summary: data.markdown,
        speakers,
        tags,
        structured_summary: structuredStr,
      });
      
      loadHistory();

      // Trigger background RAG vector indexing for the newly created meeting
      if (settings.ragEnabled) {
        await invoke("send_command_to_python", {
          payload: JSON.stringify({
            action: "INDEX_MEETING",
            meeting_id: meetingId,
            title: titleStr,
            date: dateStr,
            raw_transcript: transcription,
            embedding_provider: settings.ragProvider,
            embedding_model: settings.ragEmbeddingModel
          })
        });
      }
    } catch (err) {
      console.error("Failed to save auto-summarized meeting:", err);
    }
  });

  useEffect(() => {
    win.setAlwaysOnTop(settings.alwaysOnTop).catch(console.error);
  }, [settings.alwaysOnTop, win]);

  const togglePause = async () => {
    if (!isRecording) return;
    const action = isPaused ? "RESUME_RECORDING" : "PAUSE_RECORDING";
    setIsPaused(!isPaused);
    try {
      await invoke("send_command_to_python", { payload: JSON.stringify({ action }) });
    } catch (e) {
      console.error("Pause IPC error:", e);
    }
  };

  // Global shortcuts
  const toggleRecordingRef = useRef(toggleRecording);
  const togglePauseRef = useRef(togglePause);
  const toggleWindowModeRef = useRef(toggleWindowMode);
  const isRecordingRef = useRef(isRecording);

  useEffect(() => {
    toggleRecordingRef.current = toggleRecording;
    togglePauseRef.current = togglePause;
    toggleWindowModeRef.current = toggleWindowMode;
    isRecordingRef.current = isRecording;
  });

  useEffect(() => {
    const unlistenR = listen("shortcut:toggle-recording", () => toggleRecordingRef.current());
    const unlistenP = listen("shortcut:toggle-pause", () => {
      if (isRecordingRef.current) togglePauseRef.current();
    });
    const unlistenE = listen("shortcut:toggle-expand", () => toggleWindowModeRef.current());
    return () => {
      unlistenR.then((f) => f());
      unlistenP.then((f) => f());
      unlistenE.then((f) => f());
    };
  }, []);

  return isExpanded ? (
    <ExpandedView isTransitioning={isTransitioning} toggleWindowMode={toggleWindowMode} />
  ) : (
    <CompactWidget isTransitioning={isTransitioning} toggleWindowMode={toggleWindowMode} />
  );
}

function InnerRoot() {
  const { settings, loading } = useSettings();
  const isPopover = getCurrentWindow().label === "popover";
  
  if (isPopover) return <PopoverWidget />;
  
  if (loading) return null;
  
  if (!settings.onboarding_completed) {
    return <OnboardingWizard />;
  }

  return <MainApp />;
}

export default function Root() {
  return (
    <SettingsProvider>
      <ThemeProvider>
        <IpcProvider>
          <InnerRoot />
        </IpcProvider>
      </ThemeProvider>
    </SettingsProvider>
  );
}