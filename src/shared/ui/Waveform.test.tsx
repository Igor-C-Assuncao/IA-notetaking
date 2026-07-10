// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Igor Cassimiro Assunção
import { describe, expect, test } from "vitest";
import { render } from "@testing-library/react";
import { Waveform } from "./Waveform";

describe("Waveform", () => {
  test("renders a single bar layer for legacy level input", () => {
    const { container } = render(<Waveform bars={3} level={0.2} active={false} />);
    const barWrappers = container.firstElementChild?.children;

    expect(barWrappers).toHaveLength(3);
    expect(barWrappers?.[0].children).toHaveLength(1);
  });

  test("renders overlaid mic and system layers when both levels are provided", () => {
    const { container } = render(<Waveform bars={3} level={0.4} micLevel={0.1} systemLevel={0.4} active={false} />);
    const barWrappers = container.firstElementChild?.children;

    expect(barWrappers).toHaveLength(3);
    expect(barWrappers?.[0].children).toHaveLength(2);
  });
});
