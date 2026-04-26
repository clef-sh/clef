import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders title only when no body or action", () => {
    render(<EmptyState title="No keys declared yet" data-testid="empty" />);
    expect(screen.getByText("No keys declared yet")).toBeInTheDocument();
    expect(screen.getByTestId("empty").className).toContain("border-dashed");
  });

  it("renders body and action when provided", () => {
    render(
      <EmptyState title="Loading" body="Loading manifest..." action={<button>Retry</button>} />,
    );
    expect(screen.getByText("Loading manifest...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("renders icon slot", () => {
    render(<EmptyState icon={<span data-testid="ic">!</span>} title="Empty" />);
    expect(screen.getByTestId("ic")).toBeInTheDocument();
  });
});
