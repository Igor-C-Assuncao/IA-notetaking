import { describe, test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toggle } from "./Toggle";

describe("Toggle Component", () => {
  test("renders correctly with active status", () => {
    render(<Toggle checked={true} onChange={vi.fn()} label="System Monitoring" />);
    
    expect(screen.getByText("System Monitoring")).toBeInTheDocument();
    const switchElement = screen.getByRole("switch");
    expect(switchElement).toHaveAttribute("aria-checked", "true");
  });

  test("renders correctly with inactive status", () => {
    render(<Toggle checked={false} onChange={vi.fn()} />);
    
    const switchElement = screen.getByRole("switch");
    expect(switchElement).toHaveAttribute("aria-checked", "false");
  });

  test("triggers onChange handler when clicked", () => {
    const handleChange = vi.fn();
    render(<Toggle checked={false} onChange={handleChange} />);
    
    const switchElement = screen.getByRole("switch");
    fireEvent.click(switchElement);
    
    expect(handleChange).toHaveBeenCalledWith(true);
  });

  test("triggers onChange handler when Space bar is pressed", () => {
    const handleChange = vi.fn();
    render(<Toggle checked={false} onChange={handleChange} />);
    
    const switchElement = screen.getByRole("switch");
    fireEvent.keyDown(switchElement, { key: " " });
    
    expect(handleChange).toHaveBeenCalledWith(true);
  });

  test("triggers onChange handler when Enter key is pressed", () => {
    const handleChange = vi.fn();
    render(<Toggle checked={true} onChange={handleChange} />);
    
    const switchElement = screen.getByRole("switch");
    fireEvent.keyDown(switchElement, { key: "Enter" });
    
    expect(handleChange).toHaveBeenCalledWith(false);
  });

  test("does not trigger onChange when disabled and clicked", () => {
    const handleChange = vi.fn();
    render(<Toggle checked={false} onChange={handleChange} disabled={true} />);
    
    const switchElement = screen.getByRole("switch");
    fireEvent.click(switchElement);
    
    expect(handleChange).not.toHaveBeenCalled();
    expect(switchElement).toHaveAttribute("aria-disabled", "true");
  });
});
