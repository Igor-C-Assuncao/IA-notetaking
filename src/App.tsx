// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
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

import { EngineBootstrap } from "@features/bootstrap/EngineBootstrap";
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
    const transcriptText = data.raw_transcript || transcription;
    if (!transcriptText) return;
    try {
      // Rust's stdout reader already saves NOTES_GENERATED directly to DB.
      // If it succeeded, `saved_meeting_id` will be present in the enriched event.
      const rustSavedId = (data as any).saved_meeting_id as number | undefined;
      
      let meetingId: number;
      
      if (rustSavedId) {
        // Rust already persisted — skip duplicate INSERT
        meetingId = rustSavedId;
      } else {
        // Fallback: Rust save failed or old build — save from frontend
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 19).replace('T', ' ');
        const titleStr = `Meeting on ${now.toLocaleDateString()}`;
        
        const speakers = data.structured?.participants
          ? JSON.stringify(data.structured.participants.map((participant) => participant.name))
          : null;
        const tags = data.structured?.metadata?.tags
          ? JSON.stringify(data.structured.metadata.tags)
          : null;
        const structuredStr = JSON.stringify(data.structured);
        
        meetingId = await invoke<number>("save_meeting", {
          date: dateStr,
          title: titleStr,
          raw_transcript: transcriptText,
          markdown_summary: data.markdown,
          speakers,
          tags,
          structured_summary: structuredStr,
          transcript_segments: data.transcript_segments
            ? JSON.stringify(data.transcript_segments)
            : null,
          schema_version: data.schema_version || 1,
        });
      }
      
      loadHistory();

      // Trigger background RAG vector indexing for the newly created meeting.
      // Index with the persisted title/date so RAG citations and continuity
      // chips match the meeting shown in the sidebar (not synthetic values).
      if (settings.ragEnabled) {
        const now = new Date();
        let savedTitle: string | undefined;
        let savedDate: string | undefined;
        try {
          const meetings = await invoke<{ id: number; title: string; date: string }[]>("get_meetings");
          const saved = meetings.find((m) => m.id === meetingId);
          savedTitle = saved?.title;
          savedDate = saved?.date;
        } catch (err) {
          console.warn("Could not read saved meeting for indexing metadata:", err);
        }
        await invoke("send_command_to_python", {
          payload: JSON.stringify({
            action: "INDEX_MEETING",
            meeting_id: meetingId,
            title: savedTitle ?? `Meeting on ${now.toLocaleDateString()}`,
            date: savedDate ?? now.toISOString().slice(0, 19).replace('T', ' '),
            raw_transcript: transcriptText,
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
    invoke("set_compact_mode").catch(console.error);
  }, []);

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
  
  return (
    <EngineBootstrap>
      {!settings.onboarding_completed ? <OnboardingWizard /> : <MainApp />}
    </EngineBootstrap>
  );
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
