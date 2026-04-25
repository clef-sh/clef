import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Stat } from "./Stat";

describe("Stat", () => {
  it("renders label and value", () => {
    render(<Stat label="Healthy" value={12} data-testid="s" />);
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByTestId("s")).toHaveAttribute("data-tone", "default");
  });

  it("applies tone bar class for go tone", () => {
    render(<Stat label="OK" value="100%" tone="go" data-testid="s" />);
    const root = screen.getByTestId("s");
    expect(root).toHaveAttribute("data-tone", "go");
    const bar = root.querySelector("span[aria-hidden]");
    expect(bar?.className).toContain("bg-go-500");
  });

  it("applies stop tone bar class", () => {
    render(<Stat label="Down" value={3} tone="stop" data-testid="s" />);
    const bar = screen.getByTestId("s").querySelector("span[aria-hidden]");
    expect(bar?.className).toContain("bg-stop-500");
  });

  it("renders icon slot", () => {
    render(<Stat label="X" value={1} icon={<span data-testid="ico">i</span>} />);
    expect(screen.getByTestId("ico")).toBeInTheDocument();
  });
});
