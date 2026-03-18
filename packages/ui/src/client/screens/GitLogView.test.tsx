// packages/ui/src/client/screens/GitLogView.test.tsx
import React from "react";
import { render, screen, act, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { GitLogView } from "./GitLogView";
import { apiFetch } from "../api";
import type { ClefManifest } from "@clef-sh/core";

jest.mock("../api");
const mockApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

const manifest: ClefManifest = {
  version: 1,
  environments: [
    { name: "dev", description: "Dev" },
    { name: "staging", description: "Staging" },
  ],
  namespaces: [
    { name: "app", description: "App" },
    { name: "db", description: "DB" },
  ],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
};

const commits = [
  {
    hash: "abc1234def5678",
    author: "Alice",
    date: new Date("2024-06-01").toISOString(),
    message: "feat: add secret",
  },
  {
    hash: "bcd2345efg6789",
    author: "Bob",
    date: new Date("2024-05-30").toISOString(),
    message: "fix: rotate key",
  },
];

function mockOkResponse(data: unknown) {
  return { ok: true, json: async () => data } as Response;
}

describe("GitLogView", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders commit log on successful fetch", async () => {
    mockApiFetch.mockResolvedValue(mockOkResponse({ log: commits }));
    await act(async () => {
      render(<GitLogView manifest={manifest} />);
    });
    expect(screen.getByText("abc1234")).toBeInTheDocument(); // short hash
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("feat: add secret")).toBeInTheDocument();
  });

  it("shows empty state when log is empty", async () => {
    mockApiFetch.mockResolvedValue(mockOkResponse({ log: [] }));
    await act(async () => {
      render(<GitLogView manifest={manifest} />);
    });
    expect(screen.getByText(/No commits found/)).toBeInTheDocument();
  });

  it("shows error state on API failure", async () => {
    mockApiFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Git error" }),
    } as Response);
    await act(async () => {
      render(<GitLogView manifest={manifest} />);
    });
    expect(screen.getByText("Git error")).toBeInTheDocument();
  });

  it("shows loading state while fetching", async () => {
    let resolve!: (r: Response) => void;
    mockApiFetch.mockReturnValue(
      new Promise<Response>((r) => {
        resolve = r;
      }),
    );
    render(<GitLogView manifest={manifest} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    await act(async () => {
      resolve(mockOkResponse({ log: [] }));
    });
  });

  it("re-fetches when namespace selector changes", async () => {
    mockApiFetch.mockResolvedValue(mockOkResponse({ log: commits }));
    const { getByDisplayValue } = render(<GitLogView manifest={manifest} />);
    // Wait for initial fetch
    await act(async () => {});
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    // Change namespace
    const select = getByDisplayValue("app");
    await act(async () => {
      fireEvent.change(select, { target: { value: "db" } });
    });
    expect(mockApiFetch).toHaveBeenCalledTimes(2);
  });

  it("renders null manifest gracefully (no crash)", async () => {
    mockApiFetch.mockResolvedValue(mockOkResponse({ log: [] }));
    await act(async () => {
      render(<GitLogView manifest={null} />);
    });
    // Should render without throwing
    expect(screen.getByText(/No commits found/)).toBeInTheDocument();
  });
});
