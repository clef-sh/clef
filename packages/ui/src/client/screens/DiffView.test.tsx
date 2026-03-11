import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { DiffView } from "./DiffView";
import type { ClefManifest, DiffResult } from "@clef-sh/core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare let global: any;

const manifest: ClefManifest = {
  version: 1,
  environments: [
    { name: "dev", description: "Dev" },
    { name: "production", description: "Prod" },
  ],
  namespaces: [{ name: "database", description: "DB" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
};

const mockDiff: DiffResult = {
  namespace: "database",
  envA: "dev",
  envB: "production",
  rows: [
    { key: "DB_HOST", valueA: "localhost", valueB: "prod-host", status: "changed" },
    { key: "DB_PORT", valueA: "5432", valueB: "5432", status: "identical" },
    { key: "DB_REPLICA", valueA: null, valueB: "replica-host", status: "missing_a" },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (global as any).fetch;
});

describe("DiffView", () => {
  it("renders diff table with data", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDiff),
    } as Response);

    await act(async () => {
      render(<DiffView manifest={manifest} />);
    });

    expect(screen.getByText("DB_HOST")).toBeInTheDocument();
    expect(screen.getAllByText("DB_REPLICA").length).toBeGreaterThan(0);
    expect(screen.getByTestId("diff-table")).toBeInTheDocument();
    expect(screen.getByText("1 changed")).toBeInTheDocument();
  });

  it("hides identical rows by default", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDiff),
    } as Response);

    await act(async () => {
      render(<DiffView manifest={manifest} />);
    });

    expect(screen.getByText("DB_HOST")).toBeInTheDocument();
    expect(screen.queryByText("DB_PORT")).not.toBeInTheDocument();
  });

  it("shows identical rows when checkbox is checked", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDiff),
    } as Response);

    await act(async () => {
      render(<DiffView manifest={manifest} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Show identical"));
    });

    expect(screen.getByText("DB_PORT")).toBeInTheDocument();
  });

  it("shows fix hint for missing keys", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDiff),
    } as Response);

    await act(async () => {
      render(<DiffView manifest={manifest} />);
    });

    expect(screen.getByTestId("fix-hint")).toBeInTheDocument();
    expect(screen.getByText(/clef set database\/dev DB_REPLICA/)).toBeInTheDocument();
  });

  it("shows coming soon toast when sync button is clicked", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDiff),
    } as Response);

    await act(async () => {
      render(<DiffView manifest={manifest} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("sync-missing-btn"));
    });

    expect(screen.getByTestId("coming-soon-toast")).toBeInTheDocument();
  });

  it("renders empty state when no manifest", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ namespace: "", envA: "", envB: "", rows: [] }),
    } as Response);

    await act(async () => {
      render(<DiffView manifest={null} />);
    });

    expect(screen.getByText("Environment Diff")).toBeInTheDocument();
  });
});
