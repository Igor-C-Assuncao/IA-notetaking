import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface Meeting {
  id: number;
  date: string;
  title: string;
  raw_transcript: string;
  markdown_summary: string;
  speakers: string | null;
  tags: string | null;
  structured_summary: string | null;
  transcript_segments?: string | null;
  schema_version?: number;
}

// Global/Module-level state variables
let globalMeetingsHistory: Meeting[] = [];
let globalSelectedMeetingId: number | null = null;
let globalSidebarSearch = "";

const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((l) => l());
}

export function resetGlobalMeetingsState() {
  globalMeetingsHistory = [];
  globalSelectedMeetingId = null;
  globalSidebarSearch = "";
  listeners.clear();
}

export function useMeetings() {
  const [meetingsHistory, setMeetingsHistory] = useState<Meeting[]>(globalMeetingsHistory);
  const [selectedMeetingId, setSelectedMeetingIdState] = useState<number | null>(globalSelectedMeetingId);
  const [sidebarSearch, setSidebarSearchState] = useState(globalSidebarSearch);

  useEffect(() => {
    const handleChange = () => {
      setMeetingsHistory(globalMeetingsHistory);
      setSelectedMeetingIdState(globalSelectedMeetingId);
      setSidebarSearchState(globalSidebarSearch);
    };
    listeners.add(handleChange);
    return () => {
      listeners.delete(handleChange);
    };
  }, []);

  const setSelectedMeetingId = (id: number | null) => {
    globalSelectedMeetingId = id;
    emitChange();
  };

  const setSidebarSearch = (search: string) => {
    globalSidebarSearch = search;
    emitChange();
  };

  const loadHistory = async (query = "") => {
    try {
      const meetings: Meeting[] = query.trim()
        ? await invoke("search_meetings", { query })
        : await invoke("get_meetings");
      globalMeetingsHistory = meetings;
      emitChange();
    } catch (e) {
      console.error("DB fetch error:", e);
    }
  };

  useEffect(() => {
    loadHistory(globalSidebarSearch);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { loadHistory(globalSidebarSearch); }, 300);
    return () => clearTimeout(timer);
  }, [sidebarSearch]);

  return { meetingsHistory, selectedMeetingId, setSelectedMeetingId, sidebarSearch, setSidebarSearch, loadHistory };
}
