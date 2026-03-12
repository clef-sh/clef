import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MatrixView } from "./MatrixView";
import type { ClefManifest, MatrixStatus } from "@clef-sh/core";

const manifest: ClefManifest = {
  version: 1,
  environments: [
    { name: "dev", description: "Dev" },
    { name: "production", description: "Prod", protected: true },
  ],
  namespaces: [
    { name: "database", description: "DB" },
    { name: "auth", description: "Auth" },
  ],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
};

const healthyStatuses: MatrixStatus[] = [
  {
    cell: {
      namespace: "database",
      environment: "dev",
      filePath: "database/dev.enc.yaml",
      exists: true,
    },
    keyCount: 4,
    pendingCount: 0,
    lastModified: new Date(),
    issues: [],
  },
  {
    cell: {
      namespace: "database",
      environment: "production",
      filePath: "database/production.enc.yaml",
      exists: true,
    },
    keyCount: 3,
    pendingCount: 0,
    lastModified: new Date(),
    issues: [{ type: "missing_keys", message: "Key DB_REPLICA missing", key: "DB_REPLICA" }],
  },
  {
    cell: { namespace: "auth", environment: "dev", filePath: "auth/dev.enc.yaml", exists: true },
    keyCount: 6,
    pendingCount: 0,
    lastModified: new Date(),
    issues: [],
  },
  {
    cell: {
      namespace: "auth",
      environment: "production",
      filePath: "auth/production.enc.yaml",
      exists: true,
    },
    keyCount: 6,
    pendingCount: 0,
    lastModified: new Date(),
    issues: [],
  },
];

describe("MatrixView", () => {
  it("renders healthy state with summary pills", () => {
    const setView = jest.fn();
    const setNs = jest.fn();

    render(
      <MatrixView
        setView={setView}
        setNs={setNs}
        manifest={manifest}
        matrixStatuses={healthyStatuses}
      />,
    );

    expect(screen.getByText("Secret Matrix")).toBeInTheDocument();
    expect(screen.getByText(/healthy/)).toBeInTheDocument();
    expect(screen.getByText(/missing keys/)).toBeInTheDocument();
    expect(screen.getByTestId("matrix-table")).toBeInTheDocument();
  });

  it("renders loading state when manifest is null", () => {
    render(
      <MatrixView setView={jest.fn()} setNs={jest.fn()} manifest={null} matrixStatuses={[]} />,
    );

    expect(screen.getByText("Loading manifest...")).toBeInTheDocument();
  });

  it("renders empty state with zero counts", () => {
    render(
      <MatrixView setView={jest.fn()} setNs={jest.fn()} manifest={manifest} matrixStatuses={[]} />,
    );

    expect(screen.getByText("0 healthy")).toBeInTheDocument();
  });

  it("navigates to editor when row is clicked", () => {
    const setView = jest.fn();
    const setNs = jest.fn();

    render(
      <MatrixView
        setView={setView}
        setNs={setNs}
        manifest={manifest}
        matrixStatuses={healthyStatuses}
      />,
    );

    const row = screen.getByTestId("matrix-row-database");
    fireEvent.click(row);

    expect(setNs).toHaveBeenCalledWith("database");
    expect(setView).toHaveBeenCalledWith("editor");
  });

  it("navigates to diff view when button is clicked", () => {
    const setView = jest.fn();

    render(
      <MatrixView
        setView={setView}
        setNs={jest.fn()}
        manifest={manifest}
        matrixStatuses={healthyStatuses}
      />,
    );

    fireEvent.click(screen.getByTestId("diff-environments-btn"));
    expect(setView).toHaveBeenCalledWith("diff");
  });
});
