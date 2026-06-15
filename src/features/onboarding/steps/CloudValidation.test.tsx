import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { expect, test, vi } from "vitest";
import { CloudValidation } from "./CloudValidation";
import { WizardState } from "../OnboardingWizard";

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

const baseState: WizardState = {
  providerType: "cloud",
  providerName: "anthropic",
  model: "claude",
  apiKey: "valid-key",
  hfToken: "",
  diarization: false,
  theme: "liquid-glass",
  selectedDeviceId: null,
};

test("validates Anthropic keys without creating a paid message", async () => {
  vi.mocked(tauriFetch).mockResolvedValue(new Response("{}", { status: 200 }));
  const onNext = vi.fn();

  render(
    <CloudValidation
      state={baseState}
      setState={vi.fn()}
      onNext={onNext}
      onPrev={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByText("Connect Anthropic"));

  await screen.findByText(/Connection verified/);
  expect(tauriFetch).toHaveBeenCalledWith(
    "https://api.anthropic.com/v1/models",
    expect.objectContaining({
      headers: expect.objectContaining({ "x-api-key": "valid-key" }),
    }),
  );

  fireEvent.click(screen.getByText("Next"));
  await waitFor(() => expect(onNext).toHaveBeenCalled());
});
