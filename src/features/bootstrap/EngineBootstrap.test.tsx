// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ close: vi.fn() }) }));
vi.mock("@app/providers/SettingsProvider", () => ({ useSettings: () => ({ settings: {}, updateSettings: vi.fn() }) }));
vi.mock("@app/providers/IpcProvider", () => ({ usePythonEvent: vi.fn() }));

import { formatBytes } from "./EngineBootstrap";

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
