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
      render(<NamespaceEditor ns="database" manifest={manifest} />);
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
      render(<NamespaceEditor ns="database" manifest={manifest} />);
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
      render(<NamespaceEditor ns="database" manifest={manifest} />);
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
      render(<NamespaceEditor ns="database" manifest={manifest} />);
    });

    expect(screen.getByText("Decrypt failed")).toBeInTheDocument();
  });

  it("shows mode toggle when adding a key", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} />);
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
      render(<NamespaceEditor ns="database" manifest={manifest} />);
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
      render(<NamespaceEditor ns="database" manifest={manifest} />);
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
      render(<NamespaceEditor ns="database" manifest={manifest} />);
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
      render(<NamespaceEditor ns="database" manifest={manifest} />);
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
      render(<NamespaceEditor ns="database" manifest={manifest} />);
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
      render(<NamespaceEditor ns="database" manifest={manifest} />);
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
      render(<NamespaceEditor ns="database" manifest={manifest} />);
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
      render(<NamespaceEditor ns="database" manifest={manifest} />);
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

  it("shows protected confirmation dialog when adding a key in production", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} />);
    });

    // Switch to production tab
    const prodTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("production"));
    await act(async () => {
      if (prodTab) fireEvent.click(prodTab);
    });

    // Open add key form
    await act(async () => {
      fireEvent.click(screen.getByTestId("add-key-btn"));
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId("new-key-input"), {
        target: { value: "PROD_SECRET" },
      });
    });

    // Click Add — should show confirmation instead of sending request
    await act(async () => {
      fireEvent.click(screen.getByTestId("add-key-submit"));
    });

    expect(screen.getByTestId("confirm-protected-dialog")).toBeInTheDocument();
    expect(screen.getByText(/Protected environment/)).toBeInTheDocument();
  });

  it("sends confirmed: true after confirming protected add", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);
    global.fetch = fetchMock;

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} />);
    });

    // Switch to production tab
    const prodTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("production"));
    await act(async () => {
      if (prodTab) fireEvent.click(prodTab);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("add-key-btn"));
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId("new-key-input"), {
        target: { value: "PROD_SECRET" },
      });
      fireEvent.change(screen.getByTestId("new-value-input"), {
        target: { value: "s3cret" },
      });
    });

    // Click Add — triggers confirmation
    await act(async () => {
      fireEvent.click(screen.getByTestId("add-key-submit"));
    });

    // Confirm
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-protected-yes"));
    });

    const putCall = fetchMock.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any[]) =>
        typeof c[0] === "string" && c[0].includes("/PROD_SECRET") && c[1]?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    const body = JSON.parse(putCall![1].body);
    expect(body.confirmed).toBe(true);
    expect(body.value).toBe("s3cret");
  });

  it("cancels protected add when Cancel is clicked", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);
    global.fetch = fetchMock;

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} />);
    });

    // Switch to production tab
    const prodTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("production"));
    await act(async () => {
      if (prodTab) fireEvent.click(prodTab);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("add-key-btn"));
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId("new-key-input"), {
        target: { value: "PROD_SECRET" },
      });
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("add-key-submit"));
    });

    // Cancel the confirmation
    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-protected-no"));
    });

    expect(screen.queryByTestId("confirm-protected-dialog")).not.toBeInTheDocument();
    // No PUT call to PROD_SECRET should have been made
    const putCall = fetchMock.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any[]) =>
        typeof c[0] === "string" && c[0].includes("/PROD_SECRET") && c[1]?.method === "PUT",
    );
    expect(putCall).toBeUndefined();
  });

  it("shows protected warning in reset confirmation for production env", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} />);
    });

    // Switch to production tab
    const prodTab = screen.getAllByRole("tab").find((t) => t.textContent?.includes("production"));
    await act(async () => {
      if (prodTab) fireEvent.click(prodTab);
    });

    // Open overflow menu and click reset
    await act(async () => {
      fireEvent.click(screen.getByTestId("overflow-DB_HOST"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("reset-random-DB_HOST"));
    });

    expect(screen.getByTestId("confirm-reset-dialog")).toBeInTheDocument();
    expect(screen.getByText(/This is a protected environment/)).toBeInTheDocument();
  });

  it("does not show protected confirmation for non-production env", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} />);
    });

    // Stay on dev tab (default)
    await act(async () => {
      fireEvent.click(screen.getByTestId("add-key-btn"));
    });

    await act(async () => {
      fireEvent.change(screen.getByTestId("new-key-input"), {
        target: { value: "DEV_SECRET" },
      });
    });

    // Click Add — should NOT show confirmation dialog
    await act(async () => {
      fireEvent.click(screen.getByTestId("add-key-submit"));
    });

    expect(screen.queryByTestId("confirm-protected-dialog")).not.toBeInTheDocument();
  });

  it("shows accept button for pending keys", async () => {
    const decryptedWithPending = {
      ...mockDecrypted,
      pending: ["DB_HOST"],
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(decryptedWithPending),
    } as Response);

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} />);
    });

    expect(screen.getByTestId("accept-value-DB_HOST")).toBeInTheDocument();
    expect(screen.getByTestId("set-value-DB_HOST")).toBeInTheDocument();
  });

  it("calls accept endpoint and updates row with returned value", async () => {
    const decryptedWithPending = {
      ...mockDecrypted,
      pending: ["DB_HOST"],
    };
    const fetchMock = jest.fn().mockImplementation((url: string, opts?: RequestInit) => {
      if (typeof url === "string" && url.includes("/accept") && opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, key: "DB_HOST", value: "abc123" }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(decryptedWithPending),
      } as Response);
    });
    global.fetch = fetchMock;

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} />);
    });

    // Click accept
    await act(async () => {
      fireEvent.click(screen.getByTestId("accept-value-DB_HOST"));
    });

    // Verify the accept endpoint was called
    const acceptCall = fetchMock.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any[]) =>
        typeof c[0] === "string" && c[0].includes("/DB_HOST/accept") && c[1]?.method === "POST",
    );
    expect(acceptCall).toBeDefined();

    // Accept button should be gone (no longer pending)
    expect(screen.queryByTestId("accept-value-DB_HOST")).not.toBeInTheDocument();
    // Eye icon should be present (can reveal the value)
    expect(screen.getByTestId("eye-DB_HOST")).toBeInTheDocument();
  });

  it("shows delete option in overflow menu", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("overflow-DB_HOST"));
    });

    expect(screen.getByTestId("delete-key-DB_HOST")).toBeInTheDocument();
  });

  it("shows confirmation dialog before deleting a key", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("overflow-DB_HOST"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("delete-key-DB_HOST"));
    });

    expect(screen.getByTestId("confirm-delete-dialog")).toBeInTheDocument();
    expect(screen.getByText(/Permanently delete/)).toBeInTheDocument();
  });

  it("deletes key after confirming", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);
    global.fetch = fetchMock;

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("overflow-DB_HOST"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("delete-key-DB_HOST"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-delete-yes"));
    });

    // Verify DELETE was called
    const deleteCall = fetchMock.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any[]) =>
        typeof c[0] === "string" && c[0].includes("/DB_HOST") && c[1]?.method === "DELETE",
    );
    expect(deleteCall).toBeDefined();

    // Row should be removed
    expect(screen.queryByText("DB_HOST")).not.toBeInTheDocument();
  });

  it("cancels delete when Cancel is clicked", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockDecrypted),
    } as Response);

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("overflow-DB_HOST"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("delete-key-DB_HOST"));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("confirm-delete-no"));
    });

    expect(screen.queryByTestId("confirm-delete-dialog")).not.toBeInTheDocument();
    // Key should still be there
    expect(screen.getByText("DB_HOST")).toBeInTheDocument();
  });

  it("surfaces the server error when Save fails on a dirty tree", async () => {
    // Route by method: all GETs (decrypt + lint) succeed; the PUT that
    // handleSave issues rejects with a 500 (dirty-tree preflight failure).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchMock = jest.fn().mockImplementation((_url: string, init?: any) => {
      if (init?.method === "PUT") {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () =>
            Promise.resolve({
              error: "Working tree has uncommitted changes. Refusing to mutate.",
              code: "SET_ERROR",
            }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockDecrypted),
      } as Response);
    });
    global.fetch = fetchMock;

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} />);
    });

    // Reveal + edit DB_HOST to produce a dirty row.
    await act(async () => {
      fireEvent.click(screen.getByTestId("eye-DB_HOST"));
    });
    await act(async () => {
      fireEvent.change(screen.getByTestId("value-input-DB_HOST"), {
        target: { value: "rotated" },
      });
    });

    // Click the Save button (rendered once a row is dirty).
    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });

    // The server's error message reaches the user — no silent success.
    expect(screen.getByText(/Working tree has uncommitted changes/)).toBeInTheDocument();
    // Dirty indicator stays so the user can retry without re-typing.
    expect(screen.getByTestId("dirty-dot")).toBeInTheDocument();
  });

  it("bails on first failure in a batch save without issuing further PUTs", async () => {
    // All GETs succeed; every PUT 500s.  We expect handleSave to abort
    // after the first PUT and never issue the second.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchMock = jest.fn().mockImplementation((_url: string, init?: any) => {
      if (init?.method === "PUT") {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ error: "boom" }),
        } as Response);
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockDecrypted),
      } as Response);
    });
    global.fetch = fetchMock;

    await act(async () => {
      render(<NamespaceEditor ns="database" manifest={manifest} />);
    });

    // Dirty both rows.
    for (const key of ["DB_HOST", "DB_PORT"]) {
      await act(async () => {
        fireEvent.click(screen.getByTestId(`eye-${key}`));
      });
      await act(async () => {
        fireEvent.change(screen.getByTestId(`value-input-${key}`), {
          target: { value: `${key}-new` },
        });
      });
    }

    await act(async () => {
      fireEvent.click(screen.getByText("Save"));
    });

    // Exactly one PUT was attempted — the second row was skipped after the
    // first failure.  Initial GET + one PUT = 2 fetch calls total.
    const putCalls = fetchMock.mock.calls.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any[]) => c[1]?.method === "PUT",
    );
    expect(putCalls).toHaveLength(1);
    expect(screen.getByText("boom")).toBeInTheDocument();
  });
});
