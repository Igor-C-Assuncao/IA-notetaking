// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import "@testing-library/jest-dom";
import { vi, beforeEach } from "vitest";

// Define a map of mock invoke handlers to simulate native IPC command results.
export const mockInvokeHandlers: Record<string, Function> = {};

// Register a helper to easily mock invoke command calls within individual tests.
export function registerMockInvoke(commandName: string, handler: Function) {
  mockInvokeHandlers[commandName] = handler;
}

// Clear mock handlers
export function clearMockInvokes() {
  for (const key in mockInvokeHandlers) {
    delete mockInvokeHandlers[key];
  }
}

// Global mocks for Tauri APIs
vi.mock("@tauri-apps/api/core", () => {
  return {
    invoke: vi.fn(async (cmd: string, args?: any) => {
      if (mockInvokeHandlers[cmd]) {
        return mockInvokeHandlers[cmd](args);
      }
      // Provide reasonable defaults for commonly-used database and sidecar commands
      if (cmd === "get_meetings") return [];
      if (cmd === "save_meeting") return 1;
      if (cmd === "get_secret") return null;
      if (cmd === "set_secret") return;
      if (cmd === "send_command_to_python") return;
      
      console.warn(`[TAURI MOCK] Unhandled command invoked: ${cmd}`, args);
      return null;
    }),
  };
});

// Mock listen and event handling
export const mockListeners: Record<string, Function[]> = {};

vi.mock("@tauri-apps/api/event", () => {
  return {
    listen: vi.fn(async (eventName: string, handler: Function) => {
      if (!mockListeners[eventName]) {
        mockListeners[eventName] = [];
      }
      mockListeners[eventName].push(handler);
      
      // Return unlisten function
      return () => {
        mockListeners[eventName] = mockListeners[eventName].filter((h) => h !== handler);
      };
    }),
    emit: vi.fn(async (eventName: string, payload?: any) => {
      if (mockListeners[eventName]) {
        mockListeners[eventName].forEach((h) => h({ payload }));
      }
    }),
  };
});

// Mock window management features to avoid exceptions in jsdom
vi.mock("@tauri-apps/api/window", () => {
  return {
    getCurrentWindow: vi.fn(() => ({
      label: "main",
      setAlwaysOnTop: vi.fn(async () => {}),
      setDecorations: vi.fn(async () => {}),
      setSize: vi.fn(async () => {}),
      setResizable: vi.fn(async () => {}),
      center: vi.fn(async () => {}),
    })),
  };
});

beforeEach(() => {
  clearMockInvokes();
  for (const key in mockListeners) {
    delete mockListeners[key];
  }
});
