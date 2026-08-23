// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { WindowModeProvider, useWindowModeContext } from "./WindowModeProvider";

const setAlwaysOnTop = vi.fn(async () => {});
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => stableWindow,
}));
const stableWindow = { label: "main", setAlwaysOnTop };

const mockSettings = { alwaysOnTop: false };

vi.mock("@app/providers/SettingsProvider", () => ({
  useSettings: () => ({ settings: mockSettings }),
}));

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

let api: ReturnType<typeof useWindowModeContext>;

function Probe() {
  api = useWindowModeContext();
  return <span data-testid="mode">{api.mode}</span>;
}

function renderProvider() {
  return render(
    <WindowModeProvider>
      <Probe />
    </WindowModeProvider>
  );
}

const modeCalls = () =>
  invokeMock.mock.calls
    .map(([cmd]) => cmd as string)
    .filter((cmd) => cmd.startsWith("set_") && cmd.endsWith("_mode"));

describe("WindowModeProvider", () => {
  beforeEach(() => {
    invokeMock.mockClear();
    setAlwaysOnTop.mockClear();
    mockSettings.alwaysOnTop = false;
  });

  // Regression: the old guard lived in `useState`, so two triggers in the same
  // tick (hotkey + click, or key autorepeat) both read the stale pre-update
  // value, both passed, and the window visibly flip-flopped.
  test("two toggles in the same tick issue exactly one transition", async () => {
    renderProvider();

    await act(async () => {
      void api.toggleWindowMode();
      void api.toggleWindowMode();
    });

    expect(modeCalls()).toEqual(["set_expanded_mode"]);
    expect(screen.getByTestId("mode")).toHaveTextContent("expanded");
  });

  test("setMode is idempotent", async () => {
    renderProvider();

    await act(async () => {
      await api.setMode("compact");
    });
    const afterFirst = modeCalls().length;

    await act(async () => {
      await api.setMode("compact");
    });

    expect(modeCalls()).toHaveLength(afterFirst);
  });

  test("the last requested mode wins", async () => {
    renderProvider();

    await act(async () => {
      void api.setMode("expanded");
      await api.setMode("compact");
    });

    expect(screen.getByTestId("mode")).toHaveTextContent("compact");
    expect(modeCalls()).toEqual(["set_expanded_mode", "set_compact_mode"]);
  });

  // `set_compact_mode` forces always-on-top in Rust, which used to silently
  // override the user's preference every time the window collapsed.
  test("re-applies the user's alwaysOnTop preference after a transition", async () => {
    renderProvider();

    await act(async () => {
      await api.setMode("compact");
    });

    expect(setAlwaysOnTop).toHaveBeenCalledWith(false);
  });

  test("a failed transition does not pin the guard to a mode never entered", async () => {
    invokeMock.mockImplementationOnce(async () => {
      throw new Error("window gone");
    });
    renderProvider();

    await act(async () => {
      await api.setMode("expanded");
    });
    expect(screen.getByTestId("mode")).toHaveTextContent("bootstrap");

    await act(async () => {
      await api.setMode("expanded");
    });
    expect(screen.getByTestId("mode")).toHaveTextContent("expanded");
  });
});
