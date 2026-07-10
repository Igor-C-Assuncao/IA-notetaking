// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { useState, useMemo } from "react";
import { usePythonEvent } from "@app/providers/IpcProvider";
import { parseActionItems, parseTldr } from "../lib/parsers";

export function useSummary() {
  const [notes, setNotes] = useState("");
  const [structuredSummary, setStructuredSummary] = useState<any>(null);

  usePythonEvent("NOTES_GENERATED", (data) => {
    setNotes(data.markdown);
    setStructuredSummary(data.structured);
  });

  const actionItems = useMemo(() => (notes ? parseActionItems(notes) : []), [notes]);
  const tldr = useMemo(() => (notes ? parseTldr(notes) : null), [notes]);

  return { notes, setNotesText: setNotes, tldr, actionItems, structuredSummary };
}
