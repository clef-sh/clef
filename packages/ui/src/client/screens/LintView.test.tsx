import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { LintView } from "./LintView";
import type { LintResult } from "@clef-sh/core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare let global: any;

const mockLintResult: LintResult = {
  issues: [
    {
      severity: "error",
      category: "matrix",
      file: "storage/staging.enc.yaml",
      message: "File declared in manifest but does not exist",
      fixCommand: "clef init",
    },
    {
      severity: "error",
      category: "schema",
      file: "database/production.enc.yaml",
      key: "DB_REPLICA_URL",
      message: "Required key missing from file",
      fixCommand: "clef set database/production DB_REPLICA_URL",
    },
    {
      severity: "warning",
      category: "schema",
      file: "payments/staging.enc.yaml",
      key: "STRIPE_LEGACY_KEY",
      message: "Key not declared in schema",
    },
    {
      severity: "info",
      category: "sops",
      file: "payments/production.enc.yaml",
      message: "Single recipient — consider adding backup key",
    },
  ],
  fileCount: 15,
  pendingCount: 0,
};

const emptyLintResult: LintResult = { issues: [], fileCount: 15, pendingCount: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (global as any).fetch;
});

describe("LintView", () => {
  it("renders issues grouped by severity", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockLintResult),
    } as Response);

    await act(async () => {
      render(<LintView setView={jest.fn()} setNs={jest.fn()} />);
    });

    expect(screen.getByText(/Required key missing/)).toBeInTheDocument();
    expect(screen.getByText(/Key not declared/)).toBeInTheDocument();
  });

  it("shows all-clear state when no issues", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(emptyLintResult),
    } as Response);

    await act(async () => {
      render(<LintView setView={jest.fn()} setNs={jest.fn()} />);
    });

    expect(screen.getByTestId("all-clear")).toBeInTheDocument();
    expect(screen.getByText("All clear")).toBeInTheDocument();
    expect(screen.getByText(/15 files/)).toBeInTheDocument();
  });

  it("filters issues by severity", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockLintResult),
    } as Response);

    await act(async () => {
      render(<LintView setView={jest.fn()} setNs={jest.fn()} />);
    });

    expect(screen.getByText(/Required key missing/)).toBeInTheDocument();

    // Click Warnings filter button
    await act(async () => {
      fireEvent.click(screen.getByTestId("filter-warning"));
    });

    expect(screen.getByText(/Key not declared/)).toBeInTheDocument();
    expect(screen.queryByText(/Required key missing/)).not.toBeInTheDocument();
  });

  it("dismisses an issue when dismiss button is clicked", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockLintResult),
    } as Response);

    await act(async () => {
      render(<LintView setView={jest.fn()} setNs={jest.fn()} />);
    });

    expect(screen.getByText(/File declared in manifest/)).toBeInTheDocument();

    const dismissButtons = screen.getAllByLabelText("Dismiss issue");
    await act(async () => {
      fireEvent.click(dismissButtons[0]);
    });

    expect(screen.queryByText(/File declared in manifest/)).not.toBeInTheDocument();
  });

  it("navigates to editor when file reference is clicked", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockLintResult),
    } as Response);

    const setView = jest.fn();
    const setNs = jest.fn();

    await act(async () => {
      render(<LintView setView={setView} setNs={setNs} />);
    });

    fireEvent.click(screen.getByTestId("file-ref-database/production.enc.yaml"));

    expect(setView).toHaveBeenCalledWith("editor");
    expect(setNs).toHaveBeenCalledWith("database");
  });
});
