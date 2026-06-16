import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { describe, expect, test, vi } from "vitest";
import { HuggingFaceSetup } from "./HuggingFaceSetup";
import { WizardState } from "../OnboardingWizard";

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

const baseState: WizardState = {
  providerType: "local",
  providerName: "ollama",
  model: "model",
  apiKey: "",
  hfToken: "  hf_valid_token\r\n",
  diarization: false,
  theme: "liquid-glass",
  selectedDeviceId: null,
};

describe("HuggingFaceSetup", () => {
  test("validates a trimmed token using the current identity endpoint", async () => {
    const setState = vi.fn();
    vi.mocked(tauriFetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ name: "test-user" }), { status: 200 }),
    ).mockResolvedValueOnce(new Response("pipeline: ok", { status: 200 }));

    render(
      <HuggingFaceSetup
        state={baseState}
        setState={setState}
        onNext={vi.fn()}
        onPrev={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Validate" }));

    await waitFor(() => expect(tauriFetch).toHaveBeenCalledWith(
      "https://huggingface.co/api/whoami-v2",
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer hf_valid_token",
        },
      },
    ));
    expect(tauriFetch).toHaveBeenCalledWith(
      "https://huggingface.co/pyannote/speaker-diarization-3.1/resolve/main/config.yaml",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer hf_valid_token",
        },
      },
    );
    expect(await screen.findByText(/access confirmed/)).toHaveTextContent("test-user");

    const updater = setState.mock.calls[setState.mock.calls.length - 1]?.[0];
    expect(updater(baseState)).toEqual({
      ...baseState,
      hfToken: "hf_valid_token",
      diarization: true,
    });
  });

  test("does not report a server failure as an invalid token", async () => {
    vi.mocked(tauriFetch).mockResolvedValueOnce(new Response(null, { status: 503 }));

    render(
      <HuggingFaceSetup
        state={baseState}
        setState={vi.fn()}
        onNext={vi.fn()}
        onPrev={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Validate" }));

    expect(await screen.findByText(/HTTP 503/)).toBeInTheDocument();
    expect(screen.queryByText(/Invalid token/)).not.toBeInTheDocument();
  });

  test("requires gated model access after token identity succeeds", async () => {
    vi.mocked(tauriFetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: "test-user" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("restricted", { status: 401 }));

    render(
      <HuggingFaceSetup
        state={baseState}
        setState={vi.fn()}
        onNext={vi.fn()}
        onPrev={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Validate" }));

    expect(await screen.findByText(/model access is not enabled/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open model terms" })).toHaveAttribute(
      "href",
      "https://huggingface.co/pyannote/speaker-diarization-3.1",
    );
    expect(screen.getByRole("button", { name: "Re-check access" })).toBeInTheDocument();
    expect(screen.queryByText(/access confirmed/i)).not.toBeInTheDocument();
  });
});
