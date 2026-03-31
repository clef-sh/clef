import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BackendScreen } from "./BackendScreen";
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
  namespaces: [{ name: "database", description: "DB" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
};

const backendConfigResponse = {
  global: { default_backend: "age" },
  environments: [
    { name: "staging", protected: false, effective: { backend: "age" }, hasOverride: false },
    { name: "production", protected: true, effective: { backend: "age" }, hasOverride: false },
  ],
};

function mockConfigEndpoint() {
  apiFetch.mockImplementation((url: string) => {
    if (url === "/api/backend-config") {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(backendConfigResponse),
      });
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
  });
}

const setView = jest.fn();
const reloadManifest = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

describe("BackendScreen — step 1", () => {
  it("renders current backend configuration on mount", async () => {
    mockConfigEndpoint();
    await act(async () => {
      render(
        <BackendScreen manifest={manifest} setView={setView} reloadManifest={reloadManifest} />,
      );
    });

    expect(await screen.findByText(/Default backend/)).toBeTruthy();
    expect(screen.getAllByText("age").length).toBeGreaterThan(0);
  });

  it("shows all 5 backend radio buttons", async () => {
    mockConfigEndpoint();
    await act(async () => {
      render(
        <BackendScreen manifest={manifest} setView={setView} reloadManifest={reloadManifest} />,
      );
    });

    expect(screen.getByTestId("backend-radio-age")).toBeTruthy();
    expect(screen.getByTestId("backend-radio-awskms")).toBeTruthy();
    expect(screen.getByTestId("backend-radio-gcpkms")).toBeTruthy();
    expect(screen.getByTestId("backend-radio-azurekv")).toBeTruthy();
    expect(screen.getByTestId("backend-radio-pgp")).toBeTruthy();
  });

  it("shows key input when non-age backend is selected", async () => {
    mockConfigEndpoint();
    await act(async () => {
      render(
        <BackendScreen manifest={manifest} setView={setView} reloadManifest={reloadManifest} />,
      );
    });

    // Initially age is selected — no key input
    expect(screen.queryByTestId("backend-key-input")).toBeNull();

    // Select AWS KMS
    fireEvent.click(screen.getByTestId("backend-radio-awskms"));
    expect(screen.getByTestId("backend-key-input")).toBeTruthy();
  });

  it("hides key input when age is re-selected", async () => {
    mockConfigEndpoint();
    await act(async () => {
      render(
        <BackendScreen manifest={manifest} setView={setView} reloadManifest={reloadManifest} />,
      );
    });

    fireEvent.click(screen.getByTestId("backend-radio-awskms"));
    expect(screen.getByTestId("backend-key-input")).toBeTruthy();

    fireEvent.click(screen.getByTestId("backend-radio-age"));
    expect(screen.queryByTestId("backend-key-input")).toBeNull();
  });
});

describe("BackendScreen — preview and apply", () => {
  it("calls preview endpoint on Preview button click", async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/backend-config") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(backendConfigResponse),
        });
      }
      if (url === "/api/migrate-backend/preview") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              result: {
                migratedFiles: [],
                skippedFiles: [],
                rolledBack: false,
                verifiedFiles: [],
                warnings: ["Would update global default_backend \u2192 awskms"],
              },
              events: [
                { type: "info", message: "Would migrate database/staging to awskms" },
                { type: "info", message: "Would migrate database/production to awskms" },
              ],
            }),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    await act(async () => {
      render(
        <BackendScreen manifest={manifest} setView={setView} reloadManifest={reloadManifest} />,
      );
    });

    // Select AWS KMS and fill key
    fireEvent.click(screen.getByTestId("backend-radio-awskms"));
    fireEvent.change(screen.getByTestId("backend-key-input"), {
      target: { value: "arn:aws:kms:us-east-1:123:key/abc" },
    });

    // Click Preview
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });

    // Should show preview step
    await waitFor(() => {
      expect(screen.getByText(/Files to migrate/)).toBeTruthy();
    });
  });

  it("shows protected env warning on 409", async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/backend-config") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(backendConfigResponse),
        });
      }
      if (url === "/api/migrate-backend/preview") {
        return Promise.resolve({
          ok: false,
          status: 409,
          json: () =>
            Promise.resolve({
              error: "Protected environment requires confirmation",
              code: "PROTECTED_ENV",
              protected: true,
            }),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    await act(async () => {
      render(
        <BackendScreen manifest={manifest} setView={setView} reloadManifest={reloadManifest} />,
      );
    });

    // Click Preview (age is default, no key needed)
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });

    // Should show protected env confirmation
    await waitFor(() => {
      expect(screen.getByTestId("protected-confirm")).toBeTruthy();
    });
  });

  it("shows success result after apply", async () => {
    let previewCalled = false;
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/backend-config") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(backendConfigResponse),
        });
      }
      if (url === "/api/migrate-backend/preview") {
        previewCalled = true;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              result: {
                migratedFiles: [],
                skippedFiles: [],
                rolledBack: false,
                verifiedFiles: [],
                warnings: [],
              },
              events: [{ type: "info", message: "Would migrate database/staging to awskms" }],
            }),
        });
      }
      if (url === "/api/migrate-backend/apply") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              result: {
                migratedFiles: ["/repo/database/staging.enc.yaml"],
                skippedFiles: [],
                rolledBack: false,
                verifiedFiles: ["/repo/database/staging.enc.yaml"],
                warnings: [],
              },
              events: [],
            }),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    await act(async () => {
      render(
        <BackendScreen manifest={manifest} setView={setView} reloadManifest={reloadManifest} />,
      );
    });

    // Select AWS KMS
    fireEvent.click(screen.getByTestId("backend-radio-awskms"));
    fireEvent.change(screen.getByTestId("backend-key-input"), {
      target: { value: "arn:..." },
    });

    // Preview
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });
    await waitFor(() => expect(previewCalled).toBe(true));

    // Apply
    await act(async () => {
      fireEvent.click(screen.getByTestId("apply-button"));
    });

    // Should show success
    await waitFor(() => {
      expect(screen.getByText("Migration complete")).toBeTruthy();
    });
    expect(screen.getByText(/1 migrated/)).toBeTruthy();
    expect(reloadManifest).toHaveBeenCalled();
  });

  it("shows rollback state on failure", async () => {
    let previewCalled = false;
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/backend-config") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(backendConfigResponse),
        });
      }
      if (url === "/api/migrate-backend/preview") {
        previewCalled = true;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              result: {
                migratedFiles: [],
                skippedFiles: [],
                rolledBack: false,
                verifiedFiles: [],
                warnings: [],
              },
              events: [{ type: "info", message: "Would migrate database/staging to awskms" }],
            }),
        });
      }
      if (url === "/api/migrate-backend/apply") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: false,
              result: {
                migratedFiles: [],
                skippedFiles: [],
                rolledBack: true,
                error: "KMS access denied",
                verifiedFiles: [],
                warnings: ["All changes have been rolled back."],
              },
              events: [],
            }),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    await act(async () => {
      render(
        <BackendScreen manifest={manifest} setView={setView} reloadManifest={reloadManifest} />,
      );
    });

    fireEvent.click(screen.getByTestId("backend-radio-awskms"));
    fireEvent.change(screen.getByTestId("backend-key-input"), {
      target: { value: "arn:..." },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });
    await waitFor(() => expect(previewCalled).toBe(true));

    await act(async () => {
      fireEvent.click(screen.getByTestId("apply-button"));
    });

    await waitFor(() => {
      expect(screen.getByText("Migration failed")).toBeTruthy();
    });
    expect(screen.getByText(/KMS access denied/)).toBeTruthy();
    expect(screen.getAllByText(/rolled back/).length).toBeGreaterThan(0);
  });
});

describe("BackendScreen — negative cases", () => {
  it("Preview button is disabled when non-age backend has no key", async () => {
    mockConfigEndpoint();
    await act(async () => {
      render(
        <BackendScreen manifest={manifest} setView={setView} reloadManifest={reloadManifest} />,
      );
    });

    fireEvent.click(screen.getByTestId("backend-radio-awskms"));
    // Key input is empty — Preview should be disabled
    const button = screen.getByRole("button", { name: "Preview" });
    expect(button).toBeDisabled();
  });

  it("Preview button is enabled when age is selected (no key needed)", async () => {
    mockConfigEndpoint();
    await act(async () => {
      render(
        <BackendScreen manifest={manifest} setView={setView} reloadManifest={reloadManifest} />,
      );
    });

    // age is default — Preview should be enabled
    const button = screen.getByRole("button", { name: "Preview" });
    expect(button).not.toBeDisabled();
  });

  it("displays error when preview returns 500", async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/backend-config") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(backendConfigResponse),
        });
      }
      if (url === "/api/migrate-backend/preview") {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () =>
            Promise.resolve({
              error: "Unexpected sops failure",
              code: "MIGRATION_ERROR",
            }),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    await act(async () => {
      render(
        <BackendScreen manifest={manifest} setView={setView} reloadManifest={reloadManifest} />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Unexpected sops failure/)).toBeTruthy();
    });
    // Should remain on step 1
    expect(screen.getByTestId("backend-radio-age")).toBeTruthy();
  });

  it("displays error when network request fails", async () => {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/backend-config") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(backendConfigResponse),
        });
      }
      if (url === "/api/migrate-backend/preview") {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    await act(async () => {
      render(
        <BackendScreen manifest={manifest} setView={setView} reloadManifest={reloadManifest} />,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });

    await waitFor(() => {
      expect(screen.getByText(/Network error/)).toBeTruthy();
    });
  });

  it("View in Matrix button navigates away after success", async () => {
    let previewCalled = false;
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/backend-config") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(backendConfigResponse),
        });
      }
      if (url === "/api/migrate-backend/preview") {
        previewCalled = true;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              result: {
                migratedFiles: [],
                skippedFiles: [],
                rolledBack: false,
                verifiedFiles: [],
                warnings: [],
              },
              events: [{ type: "info", message: "Would migrate database/staging to awskms" }],
            }),
        });
      }
      if (url === "/api/migrate-backend/apply") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              result: {
                migratedFiles: ["/repo/database/staging.enc.yaml"],
                skippedFiles: [],
                rolledBack: false,
                verifiedFiles: ["/repo/database/staging.enc.yaml"],
                warnings: [],
              },
              events: [],
            }),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    await act(async () => {
      render(
        <BackendScreen manifest={manifest} setView={setView} reloadManifest={reloadManifest} />,
      );
    });

    fireEvent.click(screen.getByTestId("backend-radio-awskms"));
    fireEvent.change(screen.getByTestId("backend-key-input"), {
      target: { value: "arn:..." },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });
    await waitFor(() => expect(previewCalled).toBe(true));

    await act(async () => {
      fireEvent.click(screen.getByTestId("apply-button"));
    });

    await waitFor(() => {
      expect(screen.getByText("Migration complete")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "View in Matrix" }));
    expect(setView).toHaveBeenCalledWith("matrix");
  });

  it("Migrate again resets to step 1", async () => {
    let previewCalled = false;
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/backend-config") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(backendConfigResponse),
        });
      }
      if (url === "/api/migrate-backend/preview") {
        previewCalled = true;
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              result: {
                migratedFiles: [],
                skippedFiles: [],
                rolledBack: false,
                verifiedFiles: [],
                warnings: [],
              },
              events: [{ type: "info", message: "Would migrate database/staging to awskms" }],
            }),
        });
      }
      if (url === "/api/migrate-backend/apply") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              result: {
                migratedFiles: ["/repo/database/staging.enc.yaml"],
                skippedFiles: [],
                rolledBack: false,
                verifiedFiles: ["/repo/database/staging.enc.yaml"],
                warnings: [],
              },
              events: [],
            }),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    await act(async () => {
      render(
        <BackendScreen manifest={manifest} setView={setView} reloadManifest={reloadManifest} />,
      );
    });

    fireEvent.click(screen.getByTestId("backend-radio-awskms"));
    fireEvent.change(screen.getByTestId("backend-key-input"), {
      target: { value: "arn:..." },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    });
    await waitFor(() => expect(previewCalled).toBe(true));

    await act(async () => {
      fireEvent.click(screen.getByTestId("apply-button"));
    });

    await waitFor(() => {
      expect(screen.getByText("Migration complete")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Migrate again" }));
    });

    // Should be back on step 1 with config visible
    expect(screen.getByTestId("backend-radio-age")).toBeTruthy();
    expect(screen.getByText(/Current Configuration/)).toBeTruthy();
  });
});
