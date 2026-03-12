import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CopyButton } from "./CopyButton";

describe("CopyButton", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders with 'copy' label by default", () => {
    render(<CopyButton text="hello world" />);
    expect(screen.getByTestId("copy-button")).toBeInTheDocument();
    expect(screen.getByTestId("copy-button")).toHaveTextContent("copy");
  });

  it("shows 'copied!' after clicking and reverts after timeout", async () => {
    render(<CopyButton text="hello world" />);
    const button = screen.getByTestId("copy-button");

    act(() => {
      fireEvent.click(button);
    });

    expect(button).toHaveTextContent("copied!");
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello world");

    act(() => {
      jest.advanceTimersByTime(1800);
    });

    expect(button).toHaveTextContent("copy");
  });
});
