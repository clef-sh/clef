import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ResetScreen } from "./ResetScreen";
import type { ClefManifest } from "@clef-sh/core";

jest.mock("../api", () => ({
  apiFetch: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { apiFetch } = require("../api") as { apiFetch: jest.Mock };

const manifest: ClefManifest = {
  version: 1,
  environments: [
    { name: "staging", description: "Staging" },
    { name: "production", description: "Production", protected: true },
  ],
  namespaces: [
    { name: "database", description: "Database" },
    { name: "api", description: "API" },
  ],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
};

const setView = jest.fn();
const reloadManifest = jest.fn();

function renderScreen() {
  return render(
    <ResetScreen manifest={manifest} setView={setView} reloadManifest={reloadManifest} />,
  );
}

function mockResetSuccess(overrides = {}) {
  apiFetch.mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        success: true,
        result: {
          scaffoldedCells: ["/repo/database/staging.enc.yaml"],
          pendingKeysByCell: {},
          backendChanged: false,
          affectedEnvironments: ["staging"],
          ...overrides,
        },
      }),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ResetScreen — scope picker", () => {
  it("renders all three scope kinds", () => {
    renderScreen();
    expect(screen.getByTestId("reset-scope-env")).toBeTruthy();
    expect(screen.getByTestId("reset-scope-namespace")).toBeTruthy();
    expect(screen.getByTestId("reset-scope-cell")).toBeTruthy();
  });

  it("defaults to env scope and shows env dropdown populated from manifest", () => {
    renderScreen();
    const select = screen.getByTestId("reset-env-select") as HTMLSelectElement;
    expect(select).toBeTruthy();
    expect(select.value).toBe("staging");
    // Both envs in the dropdown
    expect(screen.queryByTestId("reset-namespace-select")).toBeNull();
    expect(screen.queryByTestId("reset-cell-namespace-select")).toBeNull();
  });

  it("switches to namespace scope and shows namespace dropdown", () => {
    renderScreen();
    fireEvent.click(screen.getByTestId("reset-scope-namespace"));
    const select = screen.getByTestId("reset-namespace-select") as HTMLSelectElement;
    expect(select.value).toBe("database");
    expect(screen.queryByTestId("reset-env-select")).toBeNull();
  });

  it("switches to cell scope and shows two dropdowns", () => {
    renderScreen();
    fireEvent.click(screen.getByTestId("reset-scope-cell"));
    expect(screen.getByTestId("reset-cell-namespace-select")).toBeTruthy();
    expect(screen.getByTestId("reset-cell-env-select")).toBeTruthy();
    expect(screen.queryByTestId("reset-env-select")).toBeNull();
  });
});

describe("ResetScreen — backend disclosure", () => {
  it("hides backend picker by default", () => {
    renderScreen();
    expect(screen.queryByTestId("reset-backend-radio-awskms")).toBeNull();
  });

  it("reveals backend picker when checkbox is checked", () => {
    renderScreen();
    fireEvent.click(screen.getByTestId("reset-switch-backend"));
    expect(screen.getByTestId("reset-backend-radio-age")).toBeTruthy();
    expect(screen.getByTestId("reset-backend-radio-awskms")).toBeTruthy();
  });

  it("shows key input only for non-age backends", () => {
    renderScreen();
    fireEvent.click(screen.getByTestId("reset-switch-backend"));
    // age is the default — no key input
    expect(screen.queryByTestId("reset-backend-key-input")).toBeNull();
    fireEvent.click(screen.getByTestId("reset-backend-radio-awskms"));
    expect(screen.getByTestId("reset-backend-key-input")).toBeTruthy();
  });
});

describe("ResetScreen — typed confirmation gate", () => {
  it("disables Reset button when confirmation does not match", () => {
    renderScreen();
    const button = screen.getByTestId("reset-submit") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("enables Reset button only when typed confirmation matches the scope label", () => {
    renderScreen();
    const button = screen.getByTestId("reset-submit") as HTMLButtonElement;
    const input = screen.getByTestId("reset-confirm-input") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "wrong" } });
    expect(button.disabled).toBe(true);

    fireEvent.change(input, { target: { value: "env staging" } });
    expect(button.disabled).toBe(false);
  });

  it("re-disables the button when scope changes", () => {
    renderScreen();
    const button = screen.getByTestId("reset-submit") as HTMLButtonElement;
    const input = screen.getByTestId("reset-confirm-input") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "env staging" } });
    expect(button.disabled).toBe(false);

    // Switch to namespace scope — typed confirm is cleared
    fireEvent.click(screen.getByTestId("reset-scope-namespace"));
    expect(button.disabled).toBe(true);
  });

  it("uses ns/env format for cell scope confirmation", () => {
    renderScreen();
    fireEvent.click(screen.getByTestId("reset-scope-cell"));
    const input = screen.getByTestId("reset-confirm-input") as HTMLInputElement;
    const button = screen.getByTestId("reset-submit") as HTMLButtonElement;

    fireEvent.change(input, { target: { value: "database/staging" } });
    expect(button.disabled).toBe(false);
  });

  it("blocks submit when backend switch is on but key is missing", () => {
    renderScreen();
    fireEvent.click(screen.getByTestId("reset-switch-backend"));
    fireEvent.click(screen.getByTestId("reset-backend-radio-awskms"));
    const input = screen.getByTestId("reset-confirm-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "env staging" } });

    const button = screen.getByTestId("reset-submit") as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.change(screen.getByTestId("reset-backend-key-input"), {
      target: { value: "arn:aws:kms:us-east-1:123:key/new" },
    });
    expect(button.disabled).toBe(false);
  });
});

describe("ResetScreen — submit", () => {
  it("POSTs to /api/reset with the env scope", async () => {
    mockResetSuccess();
    renderScreen();
    fireEvent.change(screen.getByTestId("reset-confirm-input"), {
      target: { value: "env staging" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reset-submit"));
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/reset",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"scope":{"kind":"env","name":"staging"}'),
      }),
    );
    expect(reloadManifest).toHaveBeenCalled();
  });

  it("POSTs the namespace scope", async () => {
    mockResetSuccess({ scaffoldedCells: ["/repo/database/s.enc.yaml"] });
    renderScreen();
    fireEvent.click(screen.getByTestId("reset-scope-namespace"));
    fireEvent.change(screen.getByTestId("reset-confirm-input"), {
      target: { value: "namespace database" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reset-submit"));
    });

    const callBody = JSON.parse(apiFetch.mock.calls[0][1].body);
    expect(callBody.scope).toEqual({ kind: "namespace", name: "database" });
  });

  it("POSTs the cell scope", async () => {
    mockResetSuccess();
    renderScreen();
    fireEvent.click(screen.getByTestId("reset-scope-cell"));
    fireEvent.change(screen.getByTestId("reset-confirm-input"), {
      target: { value: "database/staging" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reset-submit"));
    });

    const callBody = JSON.parse(apiFetch.mock.calls[0][1].body);
    expect(callBody.scope).toEqual({
      kind: "cell",
      namespace: "database",
      environment: "staging",
    });
  });

  it("includes optional backend + key when backend switch is enabled", async () => {
    mockResetSuccess({ backendChanged: true });
    renderScreen();
    fireEvent.click(screen.getByTestId("reset-switch-backend"));
    fireEvent.click(screen.getByTestId("reset-backend-radio-awskms"));
    fireEvent.change(screen.getByTestId("reset-backend-key-input"), {
      target: { value: "arn:aws:kms:us-east-1:123:key/new" },
    });
    fireEvent.change(screen.getByTestId("reset-confirm-input"), {
      target: { value: "env staging" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reset-submit"));
    });

    const callBody = JSON.parse(apiFetch.mock.calls[0][1].body);
    expect(callBody.backend).toBe("awskms");
    expect(callBody.key).toBe("arn:aws:kms:us-east-1:123:key/new");
  });

  it("includes parsed comma-separated keys", async () => {
    mockResetSuccess();
    renderScreen();
    fireEvent.change(screen.getByTestId("reset-keys-input"), {
      target: { value: " DB_URL , DB_PASSWORD " },
    });
    fireEvent.change(screen.getByTestId("reset-confirm-input"), {
      target: { value: "env staging" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reset-submit"));
    });

    const callBody = JSON.parse(apiFetch.mock.calls[0][1].body);
    expect(callBody.keys).toEqual(["DB_URL", "DB_PASSWORD"]);
  });

  it("omits keys when input is blank", async () => {
    mockResetSuccess();
    renderScreen();
    fireEvent.change(screen.getByTestId("reset-confirm-input"), {
      target: { value: "env staging" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reset-submit"));
    });

    const callBody = JSON.parse(apiFetch.mock.calls[0][1].body);
    expect(callBody.keys).toBeUndefined();
  });
});

describe("ResetScreen — result reporting", () => {
  it("shows scaffolded count and pending count on success", async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          success: true,
          result: {
            scaffoldedCells: [
              "/repo/database/staging.enc.yaml",
              "/repo/database/production.enc.yaml",
            ],
            pendingKeysByCell: {
              "/repo/database/staging.enc.yaml": ["DB_URL"],
              "/repo/database/production.enc.yaml": ["DB_URL", "DB_PASSWORD"],
            },
            backendChanged: false,
            affectedEnvironments: ["staging", "production"],
          },
        }),
    });
    renderScreen();
    fireEvent.click(screen.getByTestId("reset-scope-namespace"));
    fireEvent.change(screen.getByTestId("reset-confirm-input"), {
      target: { value: "namespace database" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reset-submit"));
    });

    expect(await screen.findByTestId("reset-done")).toBeTruthy();
    expect(screen.getByText("2 cells scaffolded, 3 pending placeholders")).toBeTruthy();
  });

  it("shows backend override notice when backend changed", async () => {
    mockResetSuccess({ backendChanged: true, affectedEnvironments: ["staging"] });
    renderScreen();
    fireEvent.change(screen.getByTestId("reset-confirm-input"), {
      target: { value: "env staging" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reset-submit"));
    });

    expect(await screen.findByText("Backend override written for: staging")).toBeTruthy();
  });

  it("navigates to matrix on View in Matrix click", async () => {
    mockResetSuccess();
    renderScreen();
    fireEvent.change(screen.getByTestId("reset-confirm-input"), {
      target: { value: "env staging" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reset-submit"));
    });

    fireEvent.click(await screen.findByTestId("reset-view-matrix"));
    expect(setView).toHaveBeenCalledWith("matrix");
  });

  it("returns to idle on Reset another click", async () => {
    mockResetSuccess();
    renderScreen();
    fireEvent.change(screen.getByTestId("reset-confirm-input"), {
      target: { value: "env staging" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reset-submit"));
    });

    expect(await screen.findByTestId("reset-done")).toBeTruthy();
    fireEvent.click(screen.getByTestId("reset-start-over"));
    expect(screen.getByTestId("reset-submit")).toBeTruthy();
    // Typed confirm is cleared
    expect((screen.getByTestId("reset-confirm-input") as HTMLInputElement).value).toBe("");
  });
});

describe("ResetScreen — error handling", () => {
  it("renders error banner on 4xx with the server message", async () => {
    apiFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Environment 'staging' not found in manifest." }),
    });
    renderScreen();
    fireEvent.change(screen.getByTestId("reset-confirm-input"), {
      target: { value: "env staging" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reset-submit"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("reset-error")).toBeTruthy();
    });
    expect(screen.getByTestId("reset-error").textContent).toContain("not found");
    // Returns to idle so user can adjust
    expect(screen.getByTestId("reset-submit")).toBeTruthy();
  });

  it("renders fallback error message when network throws", async () => {
    apiFetch.mockRejectedValue(new Error("network down"));
    renderScreen();
    fireEvent.change(screen.getByTestId("reset-confirm-input"), {
      target: { value: "env staging" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reset-submit"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("reset-error").textContent).toContain("network down");
    });
  });
});
