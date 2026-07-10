// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { registerMockInvoke } from "../../../test/setup";
import { ReprocessModal } from "./ReprocessModal";

const eventHandlers: Record<string, (data: any) => void> = {};

vi.mock("@app/providers/IpcProvider", () => ({
  usePythonEvent: (eventName: string, handler: (data: any) => void) => {
    eventHandlers[eventName] = handler;
  },
}));

vi.mock("@app/providers/SettingsProvider", () => ({
  useSettings: () => ({
    settings: {
      systemPrompt: "Focus on decisions.",
      provider: "openai",
      modelName: "gpt-4o",
      apiKey: "test-key",
    },
  }),
}));

vi.mock("@app/providers/ThemeProvider", () => ({
  useTheme: () => ({ isLG: false }),
}));

function renderModal(overrides = {}) {
  return render(
    <ReprocessModal
      meetingId={42}
      originalTitle="Weekly Sync"
      originalDate="2026-07-09"
      originalSummary="Original summary"
      onClose={vi.fn()}
      onSuccess={vi.fn()}
      {...overrides}
    />,
  );
}

describe("ReprocessModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(eventHandlers)) delete eventHandlers[key];
    registerMockInvoke("reprocess_meeting", vi.fn(async () => undefined));
  });

  test("renders filtered REPROCESS_STATUS progress, tokens, and compact log", async () => {
    renderModal();

    fireEvent.click(screen.getByText("Run Reprocess"));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("reprocess_meeting", {
      meetingId: 42,
      systemPrompt: "Focus on decisions.",
      provider: "openai",
      model: "gpt-4o",
      apiKey: "test-key",
    }));

    act(() => {
      eventHandlers.REPROCESS_STATUS({
        meeting_id: 7,
        stage: "calling_ai",
        message: "Wrong meeting",
        progress: 0.5,
        elapsed_ms: 1000,
        estimated_tokens: 111,
        token_status: "estimated",
        provider: "openai",
        model: "gpt-4o",
      });
    });

    expect(screen.queryByText("Wrong meeting")).not.toBeInTheDocument();

    act(() => {
      eventHandlers.REPROCESS_STATUS({
        meeting_id: 42,
        stage: "calling_ai",
        message: "Calling OpenAI...",
        progress: 0.35,
        elapsed_ms: 12000,
        estimated_tokens: 1234,
        token_status: "estimated",
        provider: "openai",
        model: "gpt-4o",
      });
    });

    expect(screen.getByText("Calling AI")).toBeInTheDocument();
    expect(screen.getAllByText("00:12").length).toBeGreaterThan(0);
    expect(screen.getByText("Estimated input: ~1,234 tokens.")).toBeInTheDocument();
    expect(screen.getAllByText("Calling OpenAI...").length).toBeGreaterThan(0);
    expect(screen.getByText("35%")).toBeInTheDocument();
  });

  test("keeps failed stage and log visible on reprocess failure", async () => {
    renderModal();

    fireEvent.click(screen.getByText("Run Reprocess"));

    act(() => {
      eventHandlers.REPROCESS_STATUS({
        meeting_id: 42,
        stage: "failed",
        message: "Reprocess failed: provider rejected request",
        elapsed_ms: 5000,
        estimated_tokens: 900,
        token_status: "actual_unavailable",
        provider: "openai",
        model: "gpt-4o",
      });
    });

    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Warning: Reprocess failed: provider rejected request")).toBeInTheDocument();
    expect(screen.getByText("Actual token usage not reported by provider.")).toBeInTheDocument();
    expect(screen.getAllByText("00:05").length).toBeGreaterThan(0);
  });
});