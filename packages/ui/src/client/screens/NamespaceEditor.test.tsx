import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { NamespaceEditor } from "./NamespaceEditor";
import type { ClefManifest } from "@clef-sh/core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare let global: any;

const manifest: ClefManifest = {
  version: 1,
  environments: [
    { name: "dev", description: "Dev" },
    { name: "production", description: "Prod", protected: true },
  ],
  namespaces: [{ name: "database", description: "DB" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
};

const mockDecrypted = {
  values: { DB_HOST: "localhost", DB_PORT: "5432" },
  metadata: {
    backend: "age",
    recipients: ["age1abc", "age1def"],
    lastModified: "2024-01-15",
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (global as any).fetch;
});

describe("NamespaceEditor", () => {
  it("renders with fetched data", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} onCommit={jest.fn()} />);
    });

    expect(screen.getByText("DB_HOST")).toBeInTheDocument();
    expect(screen.getByText("DB_PORT")).toBeInTheDocument();
  });

  it("shows production warning on production tab", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} onCommit={jest.fn()} />);
    });

    // Click production tab
    const tabs = screen.getAllByRole("tab");
    const prodTab = tabs.find((t) => t.textContent?.includes("production"));

    await act(async () => {
      if (prodTab) fireEvent.click(prodTab);
    });

    expect(screen.getByTestId("production-warning")).toBeInTheDocument();
  });

  it("reveals value when eye icon is clicked", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} onCommit={jest.fn()} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("eye-DB_HOST"));
    });

    expect(screen.getByTestId("value-input-DB_HOST")).toBeInTheDocument();
  });

  it("shows error state when API fails", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Decrypt failed" }),
    } as Response);

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} onCommit={jest.fn()} />);
    });

    expect(screen.getByText("Decrypt failed")).toBeInTheDocument();
  });

  it("shows mode toggle when adding a key", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} onCommit={jest.fn()} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("add-key-btn"));
    });

    expect(screen.getByTestId("mode-set-value")).toBeInTheDocument();
    expect(screen.getByTestId("mode-random")).toBeInTheDocument();
    expect(screen.getByTestId("new-value-input")).toBeInTheDocument();
  });

  it("hides value input in random mode and shows Generate button", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} onCommit={jest.fn()} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("add-key-btn"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("mode-random"));
    });

    expect(screen.queryByTestId("new-value-input")).not.toBeInTheDocument();
    expect(screen.getByTestId("add-key-submit")).toHaveTextContent("Generate random value");
  });

  it("sends random: true when adding in random mode", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);
    global.fetch = fetchMock;

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} onCommit={jest.fn()} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("add-key-btn"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("mode-random"));
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId("new-key-input"), {
        target: { value: "NEW_SECRET" },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("add-key-submit"));
    });

    const putCall = fetchMock.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any[]) =>
        typeof c[0] === "string" && c[0].includes("/NEW_SECRET") && c[1]?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    const body = JSON.parse(putCall![1].body);
    expect(body.random).toBe(true);
    expect(body.value).toBeUndefined();
  });

  it("shows overflow menu with Reset to random option", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} onCommit={jest.fn()} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("overflow-DB_HOST"));
    });

    expect(screen.getByTestId("overflow-menu-DB_HOST")).toBeInTheDocument();
    expect(screen.getByTestId("reset-random-DB_HOST")).toBeInTheDocument();
  });

  it("shows confirmation dialog before resetting to random", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} onCommit={jest.fn()} />);
    });

    // Open overflow menu
    await act(async () => {
      fireEvent.click(screen.getByTestId("overflow-DB_HOST"));
    });

    // Click reset to random
    await act(async () => {
      fireEvent.click(screen.getByTestId("reset-random-DB_HOST"));
    });

    expect(screen.getByTestId("confirm-reset-dialog")).toBeInTheDocument();
    expect(screen.getByText(/current value will be overwritten/)).toBeInTheDocument();
  });

  it("cancels reset when Cancel is clicked in confirmation", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} onCommit={jest.fn()} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("overflow-DB_HOST"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("reset-random-DB_HOST"));
    });

    // The confirmation dialog is visible
    expect(screen.getByTestId("confirm-reset-dialog")).toBeInTheDocument();

    // Click Cancel in the confirmation dialog
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-reset-no"));
    });

    expect(screen.queryByTestId("confirm-reset-dialog")).not.toBeInTheDocument();
  });

  it("sends random: true when confirming reset to random", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);
    global.fetch = fetchMock;

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} onCommit={jest.fn()} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("overflow-DB_HOST"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("reset-random-DB_HOST"));
    });

    // Click "Reset to random" button in the confirmation dialog
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-reset-yes"));
    });

    const putCall = fetchMock.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any[]) => typeof c[0] === "string" && c[0].includes("/DB_HOST") && c[1]?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    const body = JSON.parse(putCall![1].body);
    expect(body.random).toBe(true);
  });

  it("marks row dirty when value is edited", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} onCommit={jest.fn()} />);
    });

    // Reveal the value
    await act(async () => {
      fireEvent.click(screen.getByTestId("eye-DB_HOST"));
    });

    // Edit the value
    await act(async () => {
      fireEvent.change(screen.getByTestId("value-input-DB_HOST"), {
        target: { value: "newhost" },
      });
    });

    expect(screen.getByTestId("dirty-dot")).toBeInTheDocument();
  });

  it("clears decrypted values from state on idle timeout", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} onCommit={jest.fn()} />);
    });

    // Reveal a value to start the timer
    await act(async () => {
      fireEvent.click(screen.getByTestId("eye-DB_HOST"));
    });

    // Value should be visible
    expect(screen.getByTestId("value-input-DB_HOST")).toBeInTheDocument();

    // Advance time past the 5-minute idle timeout
    await act(async () => {
      jest.advanceTimersByTime(5 * 60 * 1000 + 100);
    });

    // Value should no longer be visible (masked)
    expect(screen.queryByTestId("value-input-DB_HOST")).not.toBeInTheDocument();

    jest.useRealTimers();
  });
});
