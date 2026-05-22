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
}

export function useMeetings() {
  const [meetingsHistory, setMeetingsHistory] = useState<Meeting[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<number | null>(null);
  const [sidebarSearch, setSidebarSearch] = useState("");

  const loadHistory = async (query = "") => {
    try {
      const meetings: Meeting[] = query.trim()
        ? await invoke("search_meetings", { query })
        : await invoke("get_meetings");
      setMeetingsHistory(meetings);
    } catch (e) {
      console.error("DB fetch error:", e);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { loadHistory(sidebarSearch); }, 300);
    return () => clearTimeout(timer);
  }, [sidebarSearch]);

  return { meetingsHistory, selectedMeetingId, setSelectedMeetingId, sidebarSearch, setSidebarSearch, loadHistory };
}
