import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SyncPanel } from "./SyncPanel";

const mockFetch = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockFetch;
});
afterEach(() => {
  delete (global as Record<string, unknown>).fetch;
});

describe("SyncPanel", () => {
  it("fetches preview on mount and shows missing keys", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          cells: [
            { namespace: "payments", environment: "production", missingKeys: ["API_KEY"], isProtected: true },
          ],
          totalKeys: 1,
          hasProtectedEnvs: true,
        }),
    } as Response);

    await act(async () => {
      render(<SyncPanel namespace="payments" onComplete={jest.fn()} onCancel={jest.fn()} />);
    });

    expect(screen.getByTestId("sync-preview-list")).toBeInTheDocument();
    expect(screen.getByText(/API_KEY/)).toBeInTheDocument();
    expect(screen.getByText(/protected/i)).toBeInTheDocument();
  });

  it("shows 'all in sync' when plan has 0 keys", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ cells: [], totalKeys: 0, hasProtectedEnvs: false }),
    } as Response);

    await act(async () => {
      render(<SyncPanel namespace="payments" onComplete={jest.fn()} onCancel={jest.fn()} />);
    });

    expect(screen.getByTestId("sync-in-sync")).toBeInTheDocument();
  });

  it("calls /api/sync on execute and shows done state", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            cells: [
              { namespace: "payments", environment: "staging", missingKeys: ["SECRET"], isProtected: false },
            ],
            totalKeys: 1,
            hasProtectedEnvs: false,
          }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            result: {
              modifiedCells: ["payments/staging"],
              scaffoldedKeys: { "payments/staging": ["SECRET"] },
              totalKeysScaffolded: 1,
            },
          }),
      } as Response);

    const onComplete = jest.fn();
    await act(async () => {
      render(<SyncPanel namespace="payments" onComplete={onComplete} onCancel={jest.fn()} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("sync-execute-btn"));
    });

    expect(screen.getByTestId("sync-done")).toBeInTheDocument();
  });

  it("shows error on preview failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: "Something went wrong" }),
    } as Response);

    await act(async () => {
      render(<SyncPanel namespace="payments" onComplete={jest.fn()} onCancel={jest.fn()} />);
    });

    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
  });

  it("calls onCancel when cancel is clicked", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          cells: [
            { namespace: "payments", environment: "staging", missingKeys: ["KEY"], isProtected: false },
          ],
          totalKeys: 1,
          hasProtectedEnvs: false,
        }),
    } as Response);

    const onCancel = jest.fn();
    await act(async () => {
      render(<SyncPanel namespace="payments" onComplete={jest.fn()} onCancel={onCancel} />);
    });

    fireEvent.click(screen.getByTestId("sync-cancel-btn"));
    expect(onCancel).toHaveBeenCalled();
  });
});
