import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMeetings, resetGlobalMeetingsState } from "./useMeetings";
import { invoke } from "@tauri-apps/api/core";

// Mock Tauri invoke to return customized lists
const mockMeetingsList = [
  { id: 1, date: "2026-05-23", title: "Meeting 1", raw_transcript: "Hi", markdown_summary: "TLDR", speakers: null, tags: null, structured_summary: null },
  { id: 2, date: "2026-05-24", title: "Meeting 2", raw_transcript: "Hello", markdown_summary: "Done", speakers: null, tags: null, structured_summary: null },
];

describe("useMeetings Hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    resetGlobalMeetingsState();
    
    // Default invoke stubbing
    vi.mocked(invoke).mockImplementation(async (cmd: string, args?: any) => {
      if (cmd === "get_meetings") return mockMeetingsList;
      if (cmd === "search_meetings") {
        return mockMeetingsList.filter(m => m.title.toLowerCase().includes(args.query.toLowerCase()));
      }
      return [];
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("loads historical meetings on boot", async () => {
    let hookResult: any;
    
    await act(async () => {
      const { result } = renderHook(() => useMeetings());
      hookResult = result;
    });

    expect(invoke).toHaveBeenCalledWith("get_meetings");
    expect(hookResult.current.meetingsHistory).toEqual(mockMeetingsList);
    expect(hookResult.current.selectedMeetingId).toBeNull();
    expect(hookResult.current.sidebarSearch).toBe("");
  });

  test("triggers search_meetings after debounced query input", async () => {
    const { result } = renderHook(() => useMeetings());
    
    // Fast-forward initial boot load
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    
    expect(invoke).toHaveBeenCalledWith("get_meetings");
    vi.mocked(invoke).mockClear();

    // Set search parameter
    act(() => {
      result.current.setSidebarSearch("Meeting 2");
    });
    
    // Ensure search is NOT immediately triggered due to debounce
    expect(invoke).not.toHaveBeenCalled();

    // Fast-forward timers for debounce (>300ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });

    expect(invoke).toHaveBeenCalledWith("search_meetings", { query: "Meeting 2" });
    expect(result.current.meetingsHistory).toHaveLength(1);
    expect(result.current.meetingsHistory[0].title).toBe("Meeting 2");
  });

  test("updates selected meeting ID correctly", async () => {
    const { result } = renderHook(() => useMeetings());
    
    act(() => {
      result.current.setSelectedMeetingId(42);
    });
    
    expect(result.current.selectedMeetingId).toBe(42);
  });
});
