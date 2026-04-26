import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders children with default outline + default tone classes", () => {
    render(<Badge data-testid="b">PROD</Badge>);
    const el = screen.getByTestId("b");
    expect(el).toHaveTextContent("PROD");
    expect(el.className).toContain("border-edge");
    expect(el.className).toContain("text-ash-dim");
  });

  it("applies go solid variant classes", () => {
    render(
      <Badge tone="go" variant="solid" data-testid="b">
        OK
      </Badge>,
    );
    const el = screen.getByTestId("b");
    expect(el.className).toContain("bg-go-500/15");
    expect(el.className).toContain("text-go-500");
  });

  it("applies stop outline classes", () => {
    render(
      <Badge tone="stop" data-testid="b">
        FAIL
      </Badge>,
    );
    const el = screen.getByTestId("b");
    expect(el.className).toContain("border-stop-500/40");
    expect(el.className).toContain("text-stop-500");
  });

  it("applies blue tone using blue-400 token", () => {
    render(
      <Badge tone="blue" data-testid="b">
        INFO
      </Badge>,
    );
    const el = screen.getByTestId("b");
    expect(el.className).toContain("border-blue-400/40");
    expect(el.className).toContain("text-blue-400");
  });
});
