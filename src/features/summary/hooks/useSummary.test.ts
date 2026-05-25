import { describe, test, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSummary } from "./useSummary";

let eventHandlers: Record<string, Function> = {};

vi.mock("@app/providers/IpcProvider", () => ({
  usePythonEvent: vi.fn((eventName: string, handler: Function) => {
    eventHandlers[eventName] = handler;
  }),
}));

describe("useSummary Hook", () => {
  beforeEach(() => {
    eventHandlers = {};
    vi.clearAllMocks();
  });

  test("initializes with empty notes and summaries", () => {
    const { result } = renderHook(() => useSummary());
    
    expect(result.current.notes).toBe("");
    expect(result.current.structuredSummary).toBeNull();
    expect(result.current.actionItems).toEqual([]);
    expect(result.current.tldr).toBeNull();
  });

  test("reacts to NOTES_GENERATED events and parses structures", () => {
    const { result } = renderHook(() => useSummary());
    
    const mockMarkdown = "## TL;DR\nCore outcome.\n\n### Action Items\n- [ ] Task 1\n- [ ] Task 2";
    const mockStructured = { decisions: ["Decide to test"], tags: ["test", "sprint"] };
    
    act(() => {
      eventHandlers["NOTES_GENERATED"]({
        markdown: mockMarkdown,
        structured: mockStructured,
      });
    });
    
    expect(result.current.notes).toBe(mockMarkdown);
    expect(result.current.structuredSummary).toEqual(mockStructured);
    expect(result.current.actionItems).toEqual(["Task 1", "Task 2"]);
    expect(result.current.tldr).toBe("Core outcome.");
  });
});
