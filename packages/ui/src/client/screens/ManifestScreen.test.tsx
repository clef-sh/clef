import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { ManifestScreen } from "./ManifestScreen";
import type { ClefManifest } from "@clef-sh/core";

jest.mock("../api", () => ({
  apiFetch: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { apiFetch } = require("../api") as { apiFetch: jest.Mock };

const baseManifest: ClefManifest = {
  version: 1,
  environments: [
    { name: "dev", description: "Development" },
    { name: "production", description: "Production", protected: true },
  ],
  namespaces: [
    { name: "payments", description: "Payment secrets" },
    { name: "auth", description: "Auth secrets" },
  ],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
};

const reloadManifest = jest.fn();

function mockOk(body: unknown = {}): { ok: true; json: () => Promise<unknown>; status: number } {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

function mockErr(
  status: number,
  body: { error: string; code?: string },
): { ok: false; status: number; json: () => Promise<unknown> } {
  return { ok: false, status, json: () => Promise.resolve(body) };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ManifestScreen — list rendering", () => {
  it("renders both namespaces and environments from the manifest", () => {
    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);

    // Section headers
    expect(screen.getByText("Namespaces")).toBeInTheDocument();
    expect(screen.getByText("Environments")).toBeInTheDocument();

    // Each namespace shows up as a row
    expect(screen.getByTestId("namespace-row-payments")).toBeInTheDocument();
    expect(screen.getByTestId("namespace-row-auth")).toBeInTheDocument();

    // Each environment shows up as a row
    expect(screen.getByTestId("environment-row-dev")).toBeInTheDocument();
    expect(screen.getByTestId("environment-row-production")).toBeInTheDocument();
  });

  it("shows the protected badge for protected environments", () => {
    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);

    const prodRow = screen.getByTestId("environment-row-production");
    expect(prodRow).toHaveTextContent("protected");
    const devRow = screen.getByTestId("environment-row-dev");
    expect(devRow).not.toHaveTextContent("protected");
  });

  it("shows the schema badge for namespaces with a schema set", () => {
    const manifestWithSchema: ClefManifest = {
      ...baseManifest,
      namespaces: [{ name: "payments", description: "Payments", schema: "schemas/payments.yaml" }],
    };
    render(<ManifestScreen manifest={manifestWithSchema} reloadManifest={reloadManifest} />);
    expect(screen.getByTestId("namespace-row-payments")).toHaveTextContent("schemas/payments.yaml");
  });

  it("renders an empty-state message when there are no namespaces", () => {
    const empty: ClefManifest = { ...baseManifest, namespaces: [] };
    render(<ManifestScreen manifest={empty} reloadManifest={reloadManifest} />);
    expect(screen.getByText("No namespaces declared yet.")).toBeInTheDocument();
  });
});

describe("ManifestScreen — add namespace flow", () => {
  it("opens the modal when '+ Namespace' is clicked", () => {
    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);
    fireEvent.click(screen.getByTestId("add-namespace-btn"));
    expect(screen.getByTestId("namespace-name-input")).toBeInTheDocument();
  });

  it("submits and reloads the manifest on success", async () => {
    apiFetch.mockResolvedValueOnce(mockOk({ name: "billing", description: "" }));

    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);
    fireEvent.click(screen.getByTestId("add-namespace-btn"));
    fireEvent.change(screen.getByTestId("namespace-name-input"), {
      target: { value: "billing" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("namespace-add-submit"));
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/namespaces",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"name":"billing"'),
      }),
    );
    expect(reloadManifest).toHaveBeenCalled();
  });

  it("disables submit on duplicate name and shows local error", () => {
    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);
    fireEvent.click(screen.getByTestId("add-namespace-btn"));
    fireEvent.change(screen.getByTestId("namespace-name-input"), {
      target: { value: "payments" },
    });
    expect(screen.getByText(/already exists/)).toBeInTheDocument();
    expect(screen.getByTestId("namespace-add-submit")).toBeDisabled();
  });

  it("disables submit on invalid identifier", () => {
    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);
    fireEvent.click(screen.getByTestId("add-namespace-btn"));
    fireEvent.change(screen.getByTestId("namespace-name-input"), {
      target: { value: "has spaces" },
    });
    expect(screen.getByText(/letters, numbers/)).toBeInTheDocument();
    expect(screen.getByTestId("namespace-add-submit")).toBeDisabled();
  });

  it("surfaces server error when API call fails", async () => {
    apiFetch.mockResolvedValueOnce(mockErr(409, { error: "Namespace 'billing' already exists." }));

    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);
    fireEvent.click(screen.getByTestId("add-namespace-btn"));
    fireEvent.change(screen.getByTestId("namespace-name-input"), {
      target: { value: "billing" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("namespace-add-submit"));
    });

    expect(await screen.findByTestId("manifest-modal-error")).toHaveTextContent("already exists");
    expect(reloadManifest).not.toHaveBeenCalled();
  });
});

describe("ManifestScreen — edit namespace flow", () => {
  it("opens the edit modal pre-filled with the current values", () => {
    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);
    fireEvent.click(screen.getByTestId("namespace-row-payments-edit"));

    const renameInput = screen.getByTestId("namespace-rename-input") as HTMLInputElement;
    expect(renameInput.value).toBe("payments");
    const descInput = screen.getByTestId("namespace-description-input") as HTMLInputElement;
    expect(descInput.value).toBe("Payment secrets");
  });

  it("submits a rename with the new name and previousName", async () => {
    apiFetch.mockResolvedValueOnce(mockOk({ name: "billing", previousName: "payments" }));

    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);
    fireEvent.click(screen.getByTestId("namespace-row-payments-edit"));
    fireEvent.change(screen.getByTestId("namespace-rename-input"), {
      target: { value: "billing" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("namespace-edit-submit"));
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/namespaces/payments",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"rename":"billing"'),
      }),
    );
    expect(reloadManifest).toHaveBeenCalled();
  });

  it("disables submit when nothing has changed", () => {
    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);
    fireEvent.click(screen.getByTestId("namespace-row-payments-edit"));
    expect(screen.getByTestId("namespace-edit-submit")).toBeDisabled();
  });

  it("disables submit when rename target collides with another namespace", () => {
    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);
    fireEvent.click(screen.getByTestId("namespace-row-payments-edit"));
    fireEvent.change(screen.getByTestId("namespace-rename-input"), {
      target: { value: "auth" },
    });
    expect(screen.getByText(/already exists/)).toBeInTheDocument();
    expect(screen.getByTestId("namespace-edit-submit")).toBeDisabled();
  });
});

describe("ManifestScreen — remove namespace flow", () => {
  it("opens the confirm modal and disables submit until name is typed", () => {
    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);
    fireEvent.click(screen.getByTestId("namespace-row-payments-delete"));

    // Modal H3 title — match exactly to disambiguate from the button text
    expect(screen.getByRole("heading", { name: "Delete namespace" })).toBeInTheDocument();
    expect(screen.getByTestId("namespace-remove-submit")).toBeDisabled();
  });

  it("enables submit only when the typed name matches", () => {
    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);
    fireEvent.click(screen.getByTestId("namespace-row-payments-delete"));

    fireEvent.change(screen.getByTestId("namespace-remove-confirm-input"), {
      target: { value: "wrong" },
    });
    expect(screen.getByTestId("namespace-remove-submit")).toBeDisabled();

    fireEvent.change(screen.getByTestId("namespace-remove-confirm-input"), {
      target: { value: "payments" },
    });
    expect(screen.getByTestId("namespace-remove-submit")).toBeEnabled();
  });

  it("calls DELETE and reloads on confirm", async () => {
    apiFetch.mockResolvedValueOnce(mockOk({ ok: true }));

    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);
    fireEvent.click(screen.getByTestId("namespace-row-payments-delete"));
    fireEvent.change(screen.getByTestId("namespace-remove-confirm-input"), {
      target: { value: "payments" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("namespace-remove-submit"));
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/namespaces/payments",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(reloadManifest).toHaveBeenCalled();
  });

  it("surfaces a 412 orphan-SI error from the server", async () => {
    apiFetch.mockResolvedValueOnce(
      mockErr(412, {
        error:
          "Cannot remove namespace 'payments': it is the only scope of service identity 'web-app'.",
      }),
    );

    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);
    fireEvent.click(screen.getByTestId("namespace-row-payments-delete"));
    fireEvent.change(screen.getByTestId("namespace-remove-confirm-input"), {
      target: { value: "payments" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("namespace-remove-submit"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("manifest-modal-error")).toHaveTextContent(
        "only scope of service identity",
      );
    });
    expect(reloadManifest).not.toHaveBeenCalled();
  });
});

describe("ManifestScreen — add environment flow", () => {
  it("opens the modal and submits with protected: true when checked", async () => {
    apiFetch.mockResolvedValueOnce(mockOk({ name: "canary", protected: true }));

    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);
    fireEvent.click(screen.getByTestId("add-environment-btn"));
    fireEvent.change(screen.getByTestId("environment-name-input"), {
      target: { value: "canary" },
    });
    fireEvent.click(screen.getByTestId("environment-protected-checkbox"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("environment-add-submit"));
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/environments",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"protected":true'),
      }),
    );
    expect(reloadManifest).toHaveBeenCalled();
  });

  it("disables submit on duplicate environment name", () => {
    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);
    fireEvent.click(screen.getByTestId("add-environment-btn"));
    fireEvent.change(screen.getByTestId("environment-name-input"), {
      target: { value: "production" },
    });
    expect(screen.getByText(/already exists/)).toBeInTheDocument();
    expect(screen.getByTestId("environment-add-submit")).toBeDisabled();
  });
});

describe("ManifestScreen — edit environment flow", () => {
  it("renames an environment and submits the rename payload", async () => {
    apiFetch.mockResolvedValueOnce(mockOk({ name: "development", previousName: "dev" }));

    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);
    fireEvent.click(screen.getByTestId("environment-row-dev-edit"));
    fireEvent.change(screen.getByTestId("environment-rename-input"), {
      target: { value: "development" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("environment-edit-submit"));
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/environments/dev",
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"rename":"development"'),
      }),
    );
  });

  it("toggles protected and submits the protected change only", async () => {
    apiFetch.mockResolvedValueOnce(mockOk({ name: "production" }));

    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);
    fireEvent.click(screen.getByTestId("environment-row-production-edit"));
    // production starts protected; uncheck to test the unprotect path
    fireEvent.click(screen.getByTestId("environment-protected-checkbox"));
    await act(async () => {
      fireEvent.click(screen.getByTestId("environment-edit-submit"));
    });

    const lastCall = apiFetch.mock.calls[0];
    expect(lastCall[0]).toBe("/api/environments/production");
    const body = JSON.parse((lastCall[1] as { body: string }).body);
    expect(body).toEqual({ protected: false });
  });
});

describe("ManifestScreen — remove environment flow", () => {
  it("warns about protected envs in the impact description", () => {
    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);
    fireEvent.click(screen.getByTestId("environment-row-production-delete"));
    expect(screen.getByText(/protected environment/)).toBeInTheDocument();
  });

  it("calls DELETE on confirm and reloads", async () => {
    apiFetch.mockResolvedValueOnce(mockOk({ ok: true }));

    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);
    fireEvent.click(screen.getByTestId("environment-row-dev-delete"));
    fireEvent.change(screen.getByTestId("environment-remove-confirm-input"), {
      target: { value: "dev" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("environment-remove-submit"));
    });

    expect(apiFetch).toHaveBeenCalledWith(
      "/api/environments/dev",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(reloadManifest).toHaveBeenCalled();
  });

  it("surfaces a 412 protected-env error from the server", async () => {
    apiFetch.mockResolvedValueOnce(
      mockErr(412, {
        error: "Environment 'production' is protected. Cannot remove a protected environment.",
      }),
    );

    render(<ManifestScreen manifest={baseManifest} reloadManifest={reloadManifest} />);
    fireEvent.click(screen.getByTestId("environment-row-production-delete"));
    fireEvent.change(screen.getByTestId("environment-remove-confirm-input"), {
      target: { value: "production" },
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("environment-remove-submit"));
    });

    await waitFor(() => {
      expect(screen.getByTestId("manifest-modal-error")).toHaveTextContent("protected");
    });
  });
});
