import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTranscription } from "./useTranscription";

let eventHandlers: Record<string, Function> = {};

vi.mock("@app/providers/IpcProvider", () => ({
  usePythonEvent: vi.fn((eventName: string, handler: Function) => {
    eventHandlers[eventName] = handler;
  }),
}));

describe("useTranscription Hook", () => {
  beforeEach(() => {
    eventHandlers = {};
    vi.clearAllMocks();
  });

  test("initializes with empty segments and transcripts", () => {
    const { result } = renderHook(() => useTranscription());
    
    expect(result.current.transcription).toBe("");
    expect(result.current.segments).toBeNull();
    expect(result.current.diarized).toBe(false);
    expect(result.current.search).toBe("");
    expect(result.current.filteredTranscript).toBe("");
  });

  test("reacts to TRANSCRIPTION_COMPLETED events", () => {
    const { result } = renderHook(() => useTranscription());
    
    act(() => {
      eventHandlers["TRANSCRIPTION_COMPLETED"]({
        text: "[Speaker 1]: Hello there\n[Speaker 2]: Hi",
        segments: [{ speaker: "Speaker 1", text: "Hello there" }, { speaker: "Speaker 2", text: "Hi" }],
        diarized: true,
      });
    });
    
    expect(result.current.transcription).toBe("[Speaker 1]: Hello there\n[Speaker 2]: Hi");
    expect(result.current.segments).toHaveLength(2);
    expect(result.current.diarized).toBe(true);
  });

  test("filters transcription text by search query", () => {
    const { result } = renderHook(() => useTranscription());
    
    act(() => {
      eventHandlers["TRANSCRIPTION_COMPLETED"]({
        text: "Line 1: Meeting details\nLine 2: Action points\nLine 3: Database setup",
        segments: [],
        diarized: false,
      });
    });

    // Set search query
    act(() => {
      result.current.setSearch("action");
    });
    
    expect(result.current.search).toBe("action");
    expect(result.current.filteredTranscript).toBe("Line 2: Action points");

    // Clear search query
    act(() => {
      result.current.setSearch("");
    });
    expect(result.current.filteredTranscript).toBe("Line 1: Meeting details\nLine 2: Action points\nLine 3: Database setup");
  });
});
