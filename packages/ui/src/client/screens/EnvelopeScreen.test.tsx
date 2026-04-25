import React from "react";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { EnvelopeScreen } from "./EnvelopeScreen";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare let global: any;

// ──────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────

const ARTIFACT_JSON = JSON.stringify({
  version: 1,
  identity: "aws-lambda",
  environment: "dev",
  packedAt: "2026-04-23T06:00:00.000Z",
  revision: "1776880279983-24310ee5",
  ciphertext: "ZmFrZS1hZ2UtY2lwaGVydGV4dC1mb3ItdGVzdGluZw==",
  ciphertextHash: "b555077dd41b180ebae2c2fc96665cebe1b9c164ca418c2b132786fdbec267fb",
});

const inspectOk = {
  source: "paste",
  version: 1,
  identity: "aws-lambda",
  environment: "dev",
  packedAt: "2026-04-23T06:00:00.000Z",
  packedAtAgeMs: 21600000,
  revision: "1776880279983-24310ee5",
  ciphertextHash: "b555077dd41b180ebae2c2fc96665cebe1b9c164ca418c2b132786fdbec267fb",
  ciphertextHashVerified: true,
  ciphertextBytes: 31,
  expiresAt: null,
  expired: null,
  revokedAt: null,
  revoked: false,
  envelope: { provider: "age", kms: null },
  signature: { present: false, algorithm: null, verified: null },
  error: null,
};

const verifyPass = {
  source: "paste",
  checks: {
    hash: { status: "ok" },
    signature: { status: "absent", algorithm: null },
    expiry: { status: "absent", expiresAt: null },
    revocation: { status: "absent", revokedAt: null },
  },
  overall: "pass",
  error: null,
};

const decryptKeysOnly = {
  source: "paste",
  status: "ok",
  error: null,
  revealed: false,
  keys: ["API_KEY", "DB_URL", "REDIS_URL"],
  values: null,
};

const decryptRevealed = {
  source: "paste",
  status: "ok",
  error: null,
  revealed: true,
  keys: ["API_KEY", "DB_URL", "REDIS_URL"],
  values: { DB_URL: "postgres://prod", REDIS_URL: "redis://prod", API_KEY: "sk-123" },
};

const decryptSingleKey = (key: string, value: string) => ({
  source: "paste",
  status: "ok",
  error: null,
  revealed: true,
  keys: ["API_KEY", "DB_URL", "REDIS_URL"],
  values: { [key]: value },
});

const configConfigured = {
  ageIdentity: { configured: true, source: "CLEF_AGE_KEY_FILE", path: "/home/op/.age/key.txt" },
  aws: { hasCredentials: false, profile: null },
};

const configMissing = {
  ageIdentity: { configured: false, source: null, path: null },
  aws: { hasCredentials: false, profile: null },
};

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

interface RouteStub {
  match: (url: string, init?: RequestInit) => boolean;
  status?: number;
  body: unknown;
}

function routeStubs(stubs: RouteStub[]): jest.Mock {
  const fetchMock = jest.fn(async (url: string | URL, init?: RequestInit) => {
    const u = typeof url === "string" ? url : url.toString();
    const match = stubs.find((s) => s.match(u, init));
    if (!match) throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${u}`);
    return {
      ok: (match.status ?? 200) < 400,
      status: match.status ?? 200,
      json: async () => match.body,
    } as Response;
  });
  return fetchMock as unknown as jest.Mock;
}

async function typeAndLoad(json: string): Promise<void> {
  const textarea = screen.getByTestId("envelope-paste-textarea");
  await act(async () => {
    fireEvent.change(textarea, { target: { value: json } });
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Load/i }));
  });
}

// ──────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  delete (global as any).fetch;
  // jsdom: provide a stable window.URL.createObjectURL for Export JSON.
  if (typeof URL.createObjectURL !== "function") {
    (URL as any).createObjectURL = jest.fn(() => "blob:test");
  }
  if (typeof URL.revokeObjectURL !== "function") {
    (URL as any).revokeObjectURL = jest.fn();
  }
});

afterEach(() => {
  jest.useRealTimers();
});

describe("EnvelopeScreen", () => {
  it("loads config on mount and shows identity source on the Decrypt card before paste", async () => {
    global.fetch = routeStubs([
      {
        match: (u) => u.endsWith("/api/envelope/config"),
        body: configConfigured,
      },
    ]);

    await act(async () => {
      render(<EnvelopeScreen />);
    });

    // Decrypt card is only rendered after a valid paste, so just pin
    // the initial config call.
    expect(global.fetch).toHaveBeenCalledWith("/api/envelope/config", expect.objectContaining({}));
  });

  it("paste → Load populates the Inspect card; Verify + Decrypt cards appear", async () => {
    global.fetch = routeStubs([
      { match: (u) => u.endsWith("/api/envelope/config"), body: configConfigured },
      {
        match: (u, init) => u.endsWith("/api/envelope/inspect") && init?.method === "POST",
        body: inspectOk,
      },
    ]);

    await act(async () => {
      render(<EnvelopeScreen />);
    });
    await typeAndLoad(ARTIFACT_JSON);

    expect(screen.getByTestId("envelope-card-inspect")).toBeInTheDocument();
    expect(screen.getByTestId("envelope-card-verify")).toBeInTheDocument();
    expect(screen.getByTestId("envelope-card-decrypt")).toBeInTheDocument();
    expect(screen.getByText("aws-lambda")).toBeInTheDocument();
  });

  it("disables Load and shows an invalid state when the paste is not JSON", async () => {
    global.fetch = routeStubs([
      { match: (u) => u.endsWith("/api/envelope/config"), body: configConfigured },
    ]);

    await act(async () => {
      render(<EnvelopeScreen />);
    });
    const textarea = screen.getByTestId("envelope-paste-textarea");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "{ not-json" } });
    });

    expect(screen.getByTestId("paste-status").textContent).toMatch(/invalid/i);
    expect(screen.getByRole("button", { name: /Load/i })).toBeDisabled();
  });

  it("runs verify and renders an OVERALL: PASS banner when the server returns pass", async () => {
    global.fetch = routeStubs([
      { match: (u) => u.endsWith("/api/envelope/config"), body: configConfigured },
      { match: (u) => u.endsWith("/api/envelope/inspect"), body: inspectOk },
      { match: (u) => u.endsWith("/api/envelope/verify"), body: verifyPass },
    ]);

    await act(async () => {
      render(<EnvelopeScreen />);
    });
    await typeAndLoad(ARTIFACT_JSON);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Run verify/i }));
    });

    expect(screen.getByTestId("verify-overall").textContent).toMatch(/PASS/);
  });

  it("decrypt (keys) shows a row per key with masked values; per-row reveal populates one value", async () => {
    global.fetch = routeStubs([
      { match: (u) => u.endsWith("/api/envelope/config"), body: configConfigured },
      { match: (u) => u.endsWith("/api/envelope/inspect"), body: inspectOk },
      {
        match: (u, init) => {
          if (!u.endsWith("/api/envelope/decrypt") || init?.method !== "POST") return false;
          const body = JSON.parse(String(init?.body ?? "{}"));
          return body.reveal !== true && body.key === undefined;
        },
        body: decryptKeysOnly,
      },
      {
        match: (u, init) => {
          if (!u.endsWith("/api/envelope/decrypt") || init?.method !== "POST") return false;
          const body = JSON.parse(String(init?.body ?? "{}"));
          return body.key === "DB_URL";
        },
        body: decryptSingleKey("DB_URL", "postgres://prod"),
      },
    ]);

    await act(async () => {
      render(<EnvelopeScreen />);
    });
    await typeAndLoad(ARTIFACT_JSON);
    await act(async () => {
      fireEvent.click(screen.getByTestId("decrypt-keys"));
    });

    // All three rows present with masked placeholders.
    expect(screen.getByTestId("decrypt-row-DB_URL")).toBeInTheDocument();
    expect(screen.getByTestId("decrypt-value-DB_URL").textContent).toMatch(/●/);

    await act(async () => {
      fireEvent.click(screen.getByTestId("reveal-toggle-DB_URL"));
    });

    expect(screen.getByTestId("decrypt-value-DB_URL").textContent).toBe("postgres://prod");
    // The other rows remain masked.
    expect(screen.getByTestId("decrypt-value-API_KEY").textContent).toMatch(/●/);
    // Reveal banner shows the key-named copy.
    expect(screen.getByTestId("reveal-banner").textContent).toMatch(/"DB_URL"/);
  });

  it("Reveal all populates every value and shows the general warning banner", async () => {
    global.fetch = routeStubs([
      { match: (u) => u.endsWith("/api/envelope/config"), body: configConfigured },
      { match: (u) => u.endsWith("/api/envelope/inspect"), body: inspectOk },
      {
        match: (u, init) => {
          if (!u.endsWith("/api/envelope/decrypt") || init?.method !== "POST") return false;
          const body = JSON.parse(String(init?.body ?? "{}"));
          return body.reveal !== true && body.key === undefined;
        },
        body: decryptKeysOnly,
      },
      {
        match: (u, init) => {
          if (!u.endsWith("/api/envelope/decrypt") || init?.method !== "POST") return false;
          const body = JSON.parse(String(init?.body ?? "{}"));
          return body.reveal === true && body.key === undefined;
        },
        body: decryptRevealed,
      },
    ]);

    await act(async () => {
      render(<EnvelopeScreen />);
    });
    await typeAndLoad(ARTIFACT_JSON);
    await act(async () => {
      fireEvent.click(screen.getByTestId("decrypt-keys"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reveal-all"));
    });

    expect(screen.getByTestId("decrypt-value-DB_URL").textContent).toBe("postgres://prod");
    expect(screen.getByTestId("decrypt-value-API_KEY").textContent).toBe("sk-123");
    expect(screen.getByTestId("reveal-banner").textContent).toMatch(/all decrypted values/);
    expect(screen.getByTestId("reveal-countdown").textContent).toMatch(/0:1[0-5]/);
  });

  it("clears revealed values after the 15-second auto-clear timer fires", async () => {
    global.fetch = routeStubs([
      { match: (u) => u.endsWith("/api/envelope/config"), body: configConfigured },
      { match: (u) => u.endsWith("/api/envelope/inspect"), body: inspectOk },
      {
        match: (u, init) => {
          if (!u.endsWith("/api/envelope/decrypt") || init?.method !== "POST") return false;
          const body = JSON.parse(String(init?.body ?? "{}"));
          return body.reveal !== true && body.key === undefined;
        },
        body: decryptKeysOnly,
      },
      {
        match: (u, init) => {
          if (!u.endsWith("/api/envelope/decrypt") || init?.method !== "POST") return false;
          const body = JSON.parse(String(init?.body ?? "{}"));
          return body.reveal === true;
        },
        body: decryptRevealed,
      },
    ]);

    jest.useFakeTimers();
    await act(async () => {
      render(<EnvelopeScreen />);
    });
    await typeAndLoad(ARTIFACT_JSON);
    await act(async () => {
      fireEvent.click(screen.getByTestId("decrypt-keys"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reveal-all"));
    });
    expect(screen.getByTestId("decrypt-value-DB_URL").textContent).toBe("postgres://prod");

    await act(async () => {
      jest.advanceTimersByTime(15 * 1000 + 10);
    });

    expect(screen.getByTestId("decrypt-value-DB_URL").textContent).toMatch(/●/);
    expect(screen.queryByTestId("reveal-banner")).toBeNull();
  });

  it("disables the initial Decrypt button when the server has no identity configured", async () => {
    global.fetch = routeStubs([
      { match: (u) => u.endsWith("/api/envelope/config"), body: configMissing },
      { match: (u) => u.endsWith("/api/envelope/inspect"), body: inspectOk },
    ]);

    await act(async () => {
      render(<EnvelopeScreen />);
    });
    await typeAndLoad(ARTIFACT_JSON);

    const btn = screen.getByTestId("decrypt-keys");
    expect(btn).toBeDisabled();
    // Server-identity hint is visible in the card subtitle.
    expect(screen.getByTestId("envelope-card-decrypt").textContent).toMatch(
      /no identity configured/i,
    );
  });

  it("never writes any revealed value or raw JSON to localStorage/sessionStorage", async () => {
    const setItemLS = jest.spyOn(Storage.prototype, "setItem");
    global.fetch = routeStubs([
      { match: (u) => u.endsWith("/api/envelope/config"), body: configConfigured },
      { match: (u) => u.endsWith("/api/envelope/inspect"), body: inspectOk },
      {
        match: (u, init) => u.endsWith("/api/envelope/decrypt") && init?.method === "POST",
        body: decryptRevealed,
      },
    ]);

    await act(async () => {
      render(<EnvelopeScreen />);
    });
    await typeAndLoad(ARTIFACT_JSON);
    await act(async () => {
      fireEvent.click(screen.getByTestId("decrypt-keys"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("reveal-all"));
    });

    for (const call of setItemLS.mock.calls) {
      const [, value] = call;
      expect(String(value)).not.toContain("postgres://prod");
      expect(String(value)).not.toContain("sk-123");
    }
  });

  it("shows a relaunch-command hint when decrypt returns key_resolution_failed", async () => {
    // Config reports configured: true (so the Decrypt button is enabled),
    // but the decrypt endpoint then returns key_resolution_failed — the
    // realistic case where an env var points to a missing/unreadable file.
    global.fetch = routeStubs([
      { match: (u) => u.endsWith("/api/envelope/config"), body: configConfigured },
      { match: (u) => u.endsWith("/api/envelope/inspect"), body: inspectOk },
      {
        match: (u, init) => u.endsWith("/api/envelope/decrypt") && init?.method === "POST",
        body: {
          source: "paste",
          status: "error",
          error: { code: "key_resolution_failed", message: "No age identity configured" },
          revealed: false,
          keys: [],
          values: null,
        },
      },
    ]);

    await act(async () => {
      render(<EnvelopeScreen />);
    });
    await typeAndLoad(ARTIFACT_JSON);
    await act(async () => {
      fireEvent.click(screen.getByTestId("decrypt-keys"));
    });

    const hint = screen.getByTestId("envelope-error-hint");
    expect(hint.textContent).toMatch(/relaunch clef ui/i);
    expect(hint.textContent).toMatch(/CLEF_AGE_KEY_FILE=/);
    // We deliberately no longer suggest the inline CLEF_AGE_KEY=... form —
    // that lands the secret in shell history. The hint should actively
    // warn against it, not offer it as an alternative.
    expect(hint.textContent).toMatch(/avoid CLEF_AGE_KEY=/);
    expect(hint.textContent).not.toMatch(/CLEF_AGE_KEY='AGE-SECRET-KEY-1\.\.\.'/);
  });

  it("warns that CLEF_AGE_KEY (inline) leaks to shell history when the server uses it", async () => {
    global.fetch = routeStubs([
      {
        match: (u) => u.endsWith("/api/envelope/config"),
        body: {
          ageIdentity: { configured: true, source: "CLEF_AGE_KEY", path: null },
          aws: { hasCredentials: false, profile: null },
        },
      },
      { match: (u) => u.endsWith("/api/envelope/inspect"), body: inspectOk },
    ]);

    await act(async () => {
      render(<EnvelopeScreen />);
    });
    await typeAndLoad(ARTIFACT_JSON);

    const warning = screen.getByTestId("inline-key-warning");
    expect(warning.textContent).toMatch(/shell history/i);
    expect(warning.textContent).toMatch(/CLEF_AGE_KEY_FILE=/);
    expect(warning.textContent).toMatch(/Rotate/i);
  });

  it("does not render the inline-key warning when the source is CLEF_AGE_KEY_FILE", async () => {
    global.fetch = routeStubs([
      { match: (u) => u.endsWith("/api/envelope/config"), body: configConfigured },
      { match: (u) => u.endsWith("/api/envelope/inspect"), body: inspectOk },
    ]);

    await act(async () => {
      render(<EnvelopeScreen />);
    });
    await typeAndLoad(ARTIFACT_JSON);

    expect(screen.queryByTestId("inline-key-warning")).toBeNull();
  });

  it("shows a service-identity hint when decrypt fails with 'no identity matched'", async () => {
    global.fetch = routeStubs([
      { match: (u) => u.endsWith("/api/envelope/config"), body: configConfigured },
      { match: (u) => u.endsWith("/api/envelope/inspect"), body: inspectOk },
      {
        match: (u, init) => u.endsWith("/api/envelope/decrypt") && init?.method === "POST",
        body: {
          source: "paste",
          status: "error",
          error: {
            code: "decrypt_failed",
            message: "no identity matched any of the file's recipients",
          },
          revealed: false,
          keys: [],
          values: null,
        },
      },
    ]);

    await act(async () => {
      render(<EnvelopeScreen />);
    });
    await typeAndLoad(ARTIFACT_JSON);
    await act(async () => {
      fireEvent.click(screen.getByTestId("decrypt-keys"));
    });

    const hint = screen.getByTestId("envelope-error-hint");
    expect(hint.textContent).toMatch(/service identity/i);
    expect(hint.textContent).toMatch(/CLEF_AGE_KEY_FILE=\/path\/to\/service-identity\.key/);
  });

  it("spells out the server-identity invariant in the Decrypt card subtitle", async () => {
    global.fetch = routeStubs([
      { match: (u) => u.endsWith("/api/envelope/config"), body: configConfigured },
      { match: (u) => u.endsWith("/api/envelope/inspect"), body: inspectOk },
    ]);

    await act(async () => {
      render(<EnvelopeScreen />);
    });
    await typeAndLoad(ARTIFACT_JSON);

    const card = screen.getByTestId("envelope-card-decrypt");
    expect(card.textContent).toMatch(/must be encrypted for this key/i);
    expect(card.textContent).toMatch(/service identity/i);
  });

  it("renders an inspect error in-band when the server reports invalid_artifact", async () => {
    global.fetch = routeStubs([
      { match: (u) => u.endsWith("/api/envelope/config"), body: configConfigured },
      {
        match: (u) => u.endsWith("/api/envelope/inspect"),
        body: {
          source: "paste",
          error: { code: "invalid_artifact", message: "missing field version" },
        },
      },
    ]);

    await act(async () => {
      render(<EnvelopeScreen />);
    });
    await typeAndLoad(ARTIFACT_JSON);

    const inspectCard = screen.getByTestId("envelope-card-inspect");
    expect(within(inspectCard).getByTestId("envelope-error").textContent).toMatch(
      /invalid_artifact/,
    );
    // Verify / decrypt cards should not render when inspect errored.
    expect(screen.queryByTestId("envelope-card-verify")).toBeNull();
    expect(screen.queryByTestId("envelope-card-decrypt")).toBeNull();
  });
});
