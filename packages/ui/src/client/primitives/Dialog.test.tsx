import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { Dialog } from "./Dialog";

describe("Dialog", () => {
  it("renders nothing when closed", () => {
    render(
      <Dialog open={false} onClose={() => {}}>
        <Dialog.Title>Hidden</Dialog.Title>
      </Dialog>,
    );
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
  });

  it("renders title, body, and footer when open", () => {
    render(
      <Dialog open={true} onClose={() => {}}>
        <Dialog.Title>Confirm</Dialog.Title>
        <Dialog.Body>are you sure?</Dialog.Body>
        <Dialog.Footer>
          <button>ok</button>
        </Dialog.Footer>
      </Dialog>,
    );
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Confirm")).toBeInTheDocument();
    expect(screen.getByText("are you sure?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ok" })).toBeInTheDocument();
  });

  it("calls onClose when scrim is clicked but not when panel is clicked", () => {
    const onClose = jest.fn();
    render(
      <Dialog open={true} onClose={onClose}>
        <Dialog.Body>panel</Dialog.Body>
      </Dialog>,
    );
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("dialog-scrim"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = jest.fn();
    render(
      <Dialog open={true} onClose={onClose}>
        <Dialog.Body>panel</Dialog.Body>
      </Dialog>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
