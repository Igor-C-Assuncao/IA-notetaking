import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { SettingsProvider, useSettings } from "./SettingsProvider";

const store = {
  get: vi.fn(async () => null),
  set: vi.fn(async () => undefined),
  save: vi.fn(async () => undefined),
};

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => store),
}));

function TestConsumer() {
  const { loading, updateSettings } = useSettings();
  if (loading) return <span>Loading</span>;

  return (
    <button onClick={() => updateSettings({
      provider: "openai",
      apiKey: "new-cloud-key",
    })}>
      Save provider
    </button>
  );
}

describe("SettingsProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.get.mockResolvedValue(null);
  });

  test("does not overwrite a newly supplied API key when provider changes", async () => {
    render(
      <SettingsProvider>
        <TestConsumer />
      </SettingsProvider>,
    );

    fireEvent.click(await screen.findByText("Save provider"));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("set_secret", {
      key: "openai_api_key",
      value: "new-cloud-key",
    }));

    expect(invoke).not.toHaveBeenCalledWith("get_secret", {
      key: "openai_api_key",
    });
  });
});
