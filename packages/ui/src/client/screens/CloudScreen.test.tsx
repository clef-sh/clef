import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { CloudScreen } from "./CloudScreen";
import type { ClefManifest } from "@clef-sh/core";

jest.mock("../api", () => ({
  apiFetch: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { apiFetch } = require("../api") as { apiFetch: jest.Mock };

const baseManifest: ClefManifest = {
  version: 1,
  environments: [
    { name: "dev", description: "Dev" },
    { name: "production", description: "Prod" },
  ],
  namespaces: [{ name: "database", description: "DB" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
};

const cloudManifest: ClefManifest = {
  ...baseManifest,
  cloud: { integrationId: "int_abc123", keyId: "clef:int_abc123/production" },
  environments: [
    { name: "dev", description: "Dev" },
    { name: "production", description: "Prod", sops: { backend: "cloud" } },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("CloudScreen — onboarding (not connected)", () => {
  it("renders onboarding view when cloud is not configured", async () => {
    apiFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
    await act(async () => {
      render(<CloudScreen manifest={baseManifest} />);
    });

    expect(screen.getByText("Clef Cloud")).toBeTruthy();
    expect(screen.getByText(/Managed KMS for production/)).toBeTruthy();
    expect(screen.getByText("clef cloud init --env production")).toBeTruthy();
  });

  it("renders feature list", async () => {
    apiFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
    await act(async () => {
      render(<CloudScreen manifest={baseManifest} />);
    });

    expect(screen.getByText("Managed KMS key")).toBeTruthy();
    expect(screen.getByText("Artifact hosting")).toBeTruthy();
    expect(screen.getByText("Serve endpoint")).toBeTruthy();
    expect(screen.getByText("Zero lock-in")).toBeTruthy();
  });

  it("renders learn more link to cloud.clef.sh", async () => {
    apiFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
    await act(async () => {
      render(<CloudScreen manifest={baseManifest} />);
    });

    const link = screen.getByText(/Learn more at cloud.clef.sh/);
    expect(link).toBeTruthy();
    expect(link.closest("a")).toHaveAttribute("href", "https://cloud.clef.sh");
  });

  it("renders onboarding when manifest is null", async () => {
    apiFetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({}) });
    await act(async () => {
      render(<CloudScreen manifest={null} />);
    });

    expect(screen.getByText("Clef Cloud")).toBeTruthy();
    expect(screen.getByText("clef cloud init --env production")).toBeTruthy();
  });
});

describe("CloudScreen — dashboard (connected)", () => {
  function mockStatusEndpoint(overrides?: Partial<{ authenticated: boolean }>) {
    apiFetch.mockImplementation((url: string) => {
      if (url === "/api/cloud/status") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              connected: true,
              integrationId: "int_abc123",
              keyId: "clef:int_abc123/production",
              environments: ["production"],
              authenticated: overrides?.authenticated ?? true,
            }),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });
  }

  it("renders connection status with integration details", async () => {
    mockStatusEndpoint();
    await act(async () => {
      render(<CloudScreen manifest={cloudManifest} />);
    });

    expect(screen.getByText("Connected")).toBeTruthy();
    expect(screen.getByText("int_abc123")).toBeTruthy();
    expect(screen.getByText("clef:int_abc123/production")).toBeTruthy();
  });

  it("shows cloud environments as badges", async () => {
    mockStatusEndpoint();
    await act(async () => {
      render(<CloudScreen manifest={cloudManifest} />);
    });

    expect(screen.getByText("production")).toBeTruthy();
  });

  it("shows unauthenticated warning when not logged in", async () => {
    mockStatusEndpoint({ authenticated: false });
    await act(async () => {
      render(<CloudScreen manifest={cloudManifest} />);
    });

    await waitFor(() => {
      expect(screen.getByText(/Not authenticated/)).toBeTruthy();
    });
    expect(screen.getByText(/clef cloud login/)).toBeTruthy();
  });

  it("renders Reveal & Rotate button", async () => {
    mockStatusEndpoint();
    await act(async () => {
      render(<CloudScreen manifest={cloudManifest} />);
    });

    expect(screen.getByRole("button", { name: "Reveal & Rotate" })).toBeTruthy();
  });

  it("shows token after successful rotate", async () => {
    apiFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url === "/api/cloud/status") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              connected: true,
              integrationId: "int_abc123",
              keyId: "clef:int_abc123/production",
              environments: ["production"],
              authenticated: true,
            }),
        });
      }
      if (url === "/api/cloud/token/rotate" && opts?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ token: "clef_serve_sk_test_token_123" }),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    await act(async () => {
      render(<CloudScreen manifest={cloudManifest} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reveal & Rotate" }));
    });

    await waitFor(() => {
      expect(screen.getByText("clef_serve_sk_test_token_123")).toBeTruthy();
    });

    // Copy button should appear
    expect(screen.getByTestId("copy-button")).toBeTruthy();

    // Button should change to "Rotate Again"
    expect(screen.getByRole("button", { name: "Rotate Again" })).toBeTruthy();
  });

  it("shows error when rotate fails", async () => {
    apiFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url === "/api/cloud/status") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              connected: true,
              integrationId: "int_abc123",
              keyId: "clef:int_abc123/production",
              environments: ["production"],
              authenticated: true,
            }),
        });
      }
      if (url === "/api/cloud/token/rotate" && opts?.method === "POST") {
        return Promise.resolve({
          ok: false,
          json: () => Promise.resolve({ error: "Unauthorized" }),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    await act(async () => {
      render(<CloudScreen manifest={cloudManifest} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reveal & Rotate" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Unauthorized")).toBeTruthy();
    });
  });

  it("shows error on network failure during rotate", async () => {
    apiFetch.mockImplementation((url: string, opts?: RequestInit) => {
      if (url === "/api/cloud/status") {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              connected: true,
              integrationId: "int_abc123",
              keyId: "clef:int_abc123/production",
              environments: ["production"],
              authenticated: true,
            }),
        });
      }
      if (url === "/api/cloud/token/rotate" && opts?.method === "POST") {
        return Promise.reject(new Error("Network error"));
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    });

    await act(async () => {
      render(<CloudScreen manifest={cloudManifest} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Reveal & Rotate" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeTruthy();
    });
  });

  it("renders manage billing link to cloud.clef.sh", async () => {
    mockStatusEndpoint();
    await act(async () => {
      render(<CloudScreen manifest={cloudManifest} />);
    });

    const link = screen.getByText(/Manage billing & upgrades/).closest("a");
    expect(link).toHaveAttribute("href", "https://cloud.clef.sh");
  });
});
