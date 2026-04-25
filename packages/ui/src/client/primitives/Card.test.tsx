import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Card } from "./Card";

describe("Card", () => {
  it("renders header title and subtitle and body content", () => {
    render(
      <Card data-testid="card">
        <Card.Header title="Identity" subtitle="namespace" />
        <Card.Body>hello body</Card.Body>
      </Card>,
    );
    expect(screen.getByTestId("card")).toBeInTheDocument();
    expect(screen.getByText("Identity")).toBeInTheDocument();
    expect(screen.getByText("namespace")).toBeInTheDocument();
    expect(screen.getByText("hello body")).toBeInTheDocument();
  });

  it("applies error tone border class", () => {
    render(
      <Card tone="error" data-testid="card">
        <Card.Body>broken</Card.Body>
      </Card>,
    );
    const root = screen.getByTestId("card");
    expect(root.className).toContain("border-stop-500/40");
    expect(root.className).not.toContain("border-edge ");
  });

  it("applies interactive hover classes when interactive prop set", () => {
    render(
      <Card interactive data-testid="card">
        <Card.Body>hover me</Card.Body>
      </Card>,
    );
    const root = screen.getByTestId("card");
    expect(root.className).toContain("hover:border-edge-strong");
    expect(root.className).toContain("hover:shadow-soft-drop");
  });

  it("renders header actions slot", () => {
    render(
      <Card>
        <Card.Header title="Files" actions={<button>add</button>} />
      </Card>,
    );
    expect(screen.getByRole("button", { name: "add" })).toBeInTheDocument();
  });
});
