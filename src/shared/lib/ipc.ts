import { PythonEvent } from "../types/ipc-events";
import { invoke } from "@tauri-apps/api/core";

export function parsePythonEvent(payload: string): PythonEvent | null {
  try {
    return JSON.parse(payload) as PythonEvent;
  } catch (e) {
    console.error("Failed to parse python event:", e);
    return null;
  }
}

export function sendCommand(commandName: string, args?: Record<string, unknown>) {
  return invoke(commandName, args);
}
