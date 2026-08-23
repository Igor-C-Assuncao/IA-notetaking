// SPDX-License-Identifier: Apache-2.0
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: vi.fn(), setAlwaysOnTop: vi.fn(async () => {}) }),
}));
vi.mock("@app/providers/SettingsProvider", () => ({
  useSettings: () => ({ settings: { onboarding_completed: true }, updateSettings: vi.fn() }),
}));

// Mutable registry so tests can drive the Python event stream.
const handlers: Record<string, (data: unknown) => void> = {};
vi.mock("@app/providers/IpcProvider", () => ({
  usePythonEvent: (name: string, callback: (data: unknown) => void) => {
    handlers[name] = callback;
  },
}));

import { EngineBootstrap, formatBytes } from "./EngineBootstrap";
import { WindowModeProvider } from "@features/window-chrome/WindowModeProvider";

describe("formatBytes", () => {
  test.each([
    [0, "0 B"],
    [1024, "1.0 KB"],
    [1024 ** 2, "1.0 MB"],
    [405 * 1024 ** 2, "405.0 MB"],
    [3 * 1024 ** 3, "3.0 GB"],
  ])("formats %i bytes", (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });
});

describe("EngineBootstrap window and mount behaviour", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_engine_status") {
        return { installed: true, kind: "cpu", version: "0.3.2", dev_mode: false, download_supported: true };
      }
      if (cmd === "get_engine_capabilities") {
        return { architecture: "x86_64", nvidia_available: false, gpu_supported: false, recommended_kind: "cpu", reason: "" };
      }
      return null;
    });
    for (const key of Object.keys(handlers)) delete handlers[key];
  });

  const renderReady = async () => {
    render(
      <WindowModeProvider>
        <EngineBootstrap>
          <div data-testid="app">app</div>
        </EngineBootstrap>
      </WindowModeProvider>
    );
    // Let the boot sequence settle first; otherwise its async tail commits
    // after the event and the component never observes "ready".
    await act(async () => {});
    await act(async () => {
      handlers.PREFLIGHT_RESULT?.({});
    });
  };

  // Regression: this handler used to invoke set_compact_mode. Because
  // EngineBootstrap stays mounted for the whole session, every later preflight
  // — opening settings, changing provider, any sidecar restart — collapsed an
  // expanded window with no user action.
  test("a preflight result never resizes the window", async () => {
    await renderReady();
    expect(screen.getByTestId("app")).toBeInTheDocument();

    invokeMock.mockClear();
    await act(async () => {
      handlers.PREFLIGHT_RESULT?.({});
    });

    const modeCalls = invokeMock.mock.calls
      .map(([cmd]) => cmd as string)
      .filter((cmd) => typeof cmd === "string" && cmd.startsWith("set_") && cmd.endsWith("_mode"));
    expect(modeCalls).toEqual([]);
  });

  // Regression: a late failure used to unmount children, destroying all of
  // MainApp's state — including the window mode it owned — so the remount
  // snapped the window back to the compact pill.
  test("keeps children mounted when the sidecar fails after startup", async () => {
    await renderReady();

    await act(async () => {
      handlers.SIDECAR_FAILED?.({});
    });

    expect(screen.getByTestId("app")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("could not start");
    expect(screen.getByRole("button", { name: "Retry service" })).toBeInTheDocument();
  });

  test("keeps children mounted when the engine reports a failed state", async () => {
    await renderReady();

    await act(async () => {
      handlers.ENGINE_STATE?.({ phase: "failed", message: "CUDA driver missing" });
    });

    expect(screen.getByTestId("app")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("CUDA driver missing");
  });
});
