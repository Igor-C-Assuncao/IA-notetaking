import { useState, useMemo } from "react";
import { usePythonEvent } from "@app/providers/IpcProvider";
import type { TranscriptSegment } from "@features/summary/types";

export function useTranscription() {
  const [transcription, setTranscription] = useState("");
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [diarized, setDiarized] = useState(false);
  const [language, setLanguage] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  usePythonEvent("TRANSCRIPTION_COMPLETED", (data) => {
    setTranscription(data.text);
    setSegments(data.segments);
    setDiarized(data.diarized);
    setLanguage(data.language ?? null);
  });

  const filteredTranscript = useMemo(() => {
    if (!transcription || !search.trim()) return transcription;
    return transcription
      .split("\n")
      .filter((l) => l.toLowerCase().includes(search.toLowerCase()))
      .join("\n");
  }, [transcription, search]);

  return { transcription, setTranscriptionText: setTranscription, segments, diarized, language, search, setSearch, filteredTranscript };
}
