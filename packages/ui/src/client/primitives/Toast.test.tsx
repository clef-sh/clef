import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ToastProvider, useToast } from "./Toast";

function Trigger({
  message,
  tone,
}: {
  message: string;
  tone?: "default" | "go" | "warn" | "stop";
}) {
  const { show } = useToast();
  return <button onClick={() => show(message, tone ? { tone } : undefined)}>fire</button>;
}

describe("Toast", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("shows a toast with default border when fired", () => {
    render(
      <ToastProvider>
        <Trigger message="hello" />
      </ToastProvider>,
    );
    act(() => {
      fireEvent.click(screen.getByText("fire"));
    });
    const toast = screen.getByTestId("toast");
    expect(toast).toHaveTextContent("hello");
    expect(toast.className).toContain("border-edge");
  });

  it("applies tone border class for warn", () => {
    render(
      <ToastProvider>
        <Trigger message="careful" tone="warn" />
      </ToastProvider>,
    );
    act(() => {
      fireEvent.click(screen.getByText("fire"));
    });
    expect(screen.getByTestId("toast").className).toContain("border-warn-500/40");
  });

  it("auto-dismisses after default 3000ms", () => {
    render(
      <ToastProvider>
        <Trigger message="bye" />
      </ToastProvider>,
    );
    act(() => {
      fireEvent.click(screen.getByText("fire"));
    });
    expect(screen.getByTestId("toast")).toBeInTheDocument();
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.queryByTestId("toast")).not.toBeInTheDocument();
  });

  it("throws helpful error when useToast called outside provider", () => {
    function Bad() {
      useToast();
      return null;
    }
    // suppress React error boundary console
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Bad />)).toThrow(/ToastProvider/);
    spy.mockRestore();
  });
});
