// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { AudioInputMeter } from "./AudioInputMeter";

describe("AudioInputMeter", () => {
  test("shows the no-input state below the threshold", () => {
    render(<AudioInputMeter audioLevel={0.005} />);

    expect(screen.getByRole("status", { name: "No input detected" })).toBeInTheDocument();
    expect(screen.getByText("No input detected")).toBeInTheDocument();
  });

  test("shows the low-input state for quiet audio", () => {
    render(<AudioInputMeter audioLevel={0.02} />);

    expect(screen.getByRole("status", { name: "Low input" })).toHaveClass("low");
  });

  test("shows the detected-input state and level width", () => {
    render(<AudioInputMeter audioLevel={0.05} />);

    expect(screen.getByRole("status", { name: "Input detected" })).toHaveClass("ok");
    expect(document.querySelector(".audio-input-bar")).toHaveStyle({ width: "5%" });
  });
});