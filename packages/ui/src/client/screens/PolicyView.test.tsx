import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { PolicyView } from "./PolicyView";
import type { FileRotationStatus, KeyRotationStatus } from "@clef-sh/core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare let global: any;

function okKey(name: string): KeyRotationStatus {
  return {
    key: name,
    last_rotated_at: "2026-01-01T00:00:00Z",
    last_rotated_known: true,
    rotated_by: "alice <alice@example.com>",
    rotation_count: 1,
    rotation_due: "2026-04-01T00:00:00Z",
    rotation_overdue: false,
    days_overdue: 0,
    compliant: true,
  };
}

function overdueKey(name: string, daysOverdue: number): KeyRotationStatus {
  return {
    key: name,
    last_rotated_at: "2025-01-01T00:00:00Z",
    last_rotated_known: true,
    rotated_by: "alice <alice@example.com>",
    rotation_count: 2,
    rotation_due: "2025-04-01T00:00:00Z",
    rotation_overdue: true,
    days_overdue: daysOverdue,
    compliant: false,
  };
}

function unknownKey(name: string): KeyRotationStatus {
  return {
    key: name,
    last_rotated_at: null,
    last_rotated_known: false,
    rotated_by: null,
    rotation_count: 0,
    rotation_due: null,
    rotation_overdue: false,
    days_overdue: 0,
    compliant: false,
  };
}

function makeFile(overrides: Partial<FileRotationStatus> = {}): FileRotationStatus {
  const base: FileRotationStatus = {
    path: "database/dev.enc.yaml",
    environment: "dev",
    backend: "age",
    recipients: ["age1abc"],
    last_modified: "2026-01-01T00:00:00Z",
    last_modified_known: true,
    keys: [okKey("DB_URL")],
    compliant: true,
  };
  const merged = { ...base, ...overrides };
  if (!("compliant" in overrides)) {
    merged.compliant = merged.keys.every((k) => k.compliant);
  }
  return merged;
}

const mixedResponse = {
  files: [
    makeFile({
      path: "database/production.enc.yaml",
      environment: "production",
      keys: [overdueKey("DB_PROD_URL", 380)],
    }),
    makeFile({
      path: "payments/staging.enc.yaml",
      environment: "staging",
      keys: [unknownKey("STRIPE_KEY")],
    }),
    makeFile({ path: "auth/dev.enc.yaml", environment: "dev", keys: [okKey("AUTH0_SECRET")] }),
  ],
  summary: { total_files: 3, compliant: 1, rotation_overdue: 2, unknown_metadata: 1 },
  policy: { version: 1, rotation: { max_age_days: 90 } },
  source: "default" as const,
};

const policyShowResponse = {
  policy: { version: 1, rotation: { max_age_days: 90 } },
  source: "default" as const,
  path: ".clef/policy.yaml",
  rawYaml: "version: 1\nrotation:\n  max_age_days: 90\n",
};

const allCompliantResponse = {
  files: [makeFile()],
  summary: { total_files: 1, compliant: 1, rotation_overdue: 0, unknown_metadata: 0 },
  policy: { version: 1, rotation: { max_age_days: 90 } },
  source: "file" as const,
};

function mockFetchSequence(checkBody: object, policyBody: object): jest.Mock {
  const fn = jest.fn().mockImplementation(async (url: string) => {
    if (url.endsWith("/api/policy/check")) {
      return { ok: true, json: () => Promise.resolve(checkBody) } as Response;
    }
    if (url.endsWith("/api/policy")) {
      return { ok: true, json: () => Promise.resolve(policyBody) } as Response;
    }
    return { ok: false, json: () => Promise.resolve({}) } as Response;
  });
  global.fetch = fn;
  return fn;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (global as any).fetch;
});

describe("PolicyView", () => {
  it("renders rotation rows grouped by status with summary chips", async () => {
    mockFetchSequence(mixedResponse, policyShowResponse);

    await act(async () => {
      render(<PolicyView setView={jest.fn()} setNs={jest.fn()} />);
    });

    expect(screen.getByText("database/production.enc.yaml")).toBeInTheDocument();
    expect(screen.getByText("payments/staging.enc.yaml")).toBeInTheDocument();
    expect(screen.getByText("auth/dev.enc.yaml")).toBeInTheDocument();

    expect(screen.getByTestId("filter-overdue")).toHaveTextContent("1");
    expect(screen.getByTestId("filter-unknown")).toHaveTextContent("1");
    expect(screen.getByTestId("filter-ok")).toHaveTextContent("1");
  });

  it("filters rows by status when a chip is clicked", async () => {
    mockFetchSequence(mixedResponse, policyShowResponse);

    await act(async () => {
      render(<PolicyView setView={jest.fn()} setNs={jest.fn()} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("filter-overdue"));
    });

    expect(screen.getByText("database/production.enc.yaml")).toBeInTheDocument();
    expect(screen.queryByText("auth/dev.enc.yaml")).not.toBeInTheDocument();
    expect(screen.queryByText("payments/staging.enc.yaml")).not.toBeInTheDocument();
  });

  it("shows the all-compliant state when nothing is overdue or unknown", async () => {
    mockFetchSequence(allCompliantResponse, policyShowResponse);

    await act(async () => {
      render(<PolicyView setView={jest.fn()} setNs={jest.fn()} />);
    });

    expect(screen.getByTestId("all-compliant")).toBeInTheDocument();
    expect(screen.getByText("All compliant")).toBeInTheDocument();
    // Per-key summary: 1 key across 1 file. Regex matches "1 key within ..." with any suffix.
    expect(screen.getByText(/1 key within rotation window across 1 file/)).toBeInTheDocument();
  });

  it("shows the source badge — 'Built-in default' when source is 'default'", async () => {
    mockFetchSequence(mixedResponse, policyShowResponse);

    await act(async () => {
      render(<PolicyView setView={jest.fn()} setNs={jest.fn()} />);
    });

    expect(screen.getByTestId("policy-source")).toHaveTextContent("Built-in default");
  });

  it("shows the source badge — '.clef/policy.yaml' when source is 'file'", async () => {
    mockFetchSequence(allCompliantResponse, { ...policyShowResponse, source: "file" });

    await act(async () => {
      render(<PolicyView setView={jest.fn()} setNs={jest.fn()} />);
    });

    expect(screen.getByTestId("policy-source")).toHaveTextContent(".clef/policy.yaml");
  });

  it("toggles the YAML view via the View YAML button", async () => {
    mockFetchSequence(mixedResponse, policyShowResponse);

    await act(async () => {
      render(<PolicyView setView={jest.fn()} setNs={jest.fn()} />);
    });

    expect(screen.queryByTestId("raw-yaml")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("toggle-yaml"));
    });

    expect(screen.getByTestId("raw-yaml")).toBeInTheDocument();
    expect(screen.getByTestId("raw-yaml")).toHaveTextContent("max_age_days: 90");
  });

  it("navigates to the editor when a file ref is clicked", async () => {
    mockFetchSequence(mixedResponse, policyShowResponse);
    const setView = jest.fn();
    const setNs = jest.fn();

    await act(async () => {
      render(<PolicyView setView={setView} setNs={setNs} />);
    });

    fireEvent.click(screen.getByTestId("file-ref-database/production.enc.yaml"));

    expect(setView).toHaveBeenCalledWith("editor");
    expect(setNs).toHaveBeenCalledWith("database");
  });

  it("extracts the namespace from the second-to-last path segment (nested paths)", async () => {
    // Bot repo layout: secrets/<namespace>/<env>.enc.yaml.  The namespace is
    // "github", not "secrets" — previously file.path.split("/")[0] was
    // returning "secrets" and producing a wrong `clef set` hint.
    const nested = {
      files: [
        makeFile({
          path: "secrets/github/dev.enc.yaml",
          environment: "dev",
          keys: [unknownKey("GITHUB_CLIENT_SECRET")],
        }),
      ],
      summary: { total_files: 1, compliant: 0, rotation_overdue: 1, unknown_metadata: 1 },
      policy: { version: 1, rotation: { max_age_days: 90 } },
      source: "default" as const,
    };
    mockFetchSequence(nested, policyShowResponse);
    const setView = jest.fn();
    const setNs = jest.fn();

    await act(async () => {
      render(<PolicyView setView={setView} setNs={setNs} />);
    });

    fireEvent.click(screen.getByTestId("file-ref-secrets/github/dev.enc.yaml"));

    expect(setNs).toHaveBeenCalledWith("github");
    // And the unknown-row hint should suggest the correct namespace too.
    expect(
      screen.getByText(/run clef set github\/dev GITHUB_CLIENT_SECRET to establish/),
    ).toBeInTheDocument();
  });

  it("renders a per-environment override chip when policy has environments block", async () => {
    const withEnvOverride = {
      ...mixedResponse,
      policy: {
        version: 1,
        rotation: {
          max_age_days: 90,
          environments: { production: { max_age_days: 30 } },
        },
      },
    };
    mockFetchSequence(withEnvOverride, {
      ...policyShowResponse,
      policy: withEnvOverride.policy,
    });

    await act(async () => {
      render(<PolicyView setView={jest.fn()} setNs={jest.fn()} />);
    });

    expect(screen.getByText("PRODUCTION")).toBeInTheDocument();
    expect(screen.getByText("30d")).toBeInTheDocument();
  });
});
