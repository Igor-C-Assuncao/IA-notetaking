import { useState, useMemo } from "react";
import { usePythonEvent } from "@app/providers/IpcProvider";

export function useTranscription() {
  const [transcription, setTranscription] = useState("");
  const [segments, setSegments] = useState<any[] | null>(null);
  const [diarized, setDiarized] = useState(false);
  const [search, setSearch] = useState("");

  usePythonEvent("TRANSCRIPTION_COMPLETED", (data) => {
    setTranscription(data.text);
    setSegments(data.segments);
    setDiarized(data.diarized);
  });

  const filteredTranscript = useMemo(() => {
    if (!transcription || !search.trim()) return transcription;
    return transcription
      .split("\n")
      .filter((l) => l.toLowerCase().includes(search.toLowerCase()))
      .join("\n");
  }, [transcription, search]);

  return { transcription, setTranscriptionText: setTranscription, segments, diarized, search, setSearch, filteredTranscript };
}
