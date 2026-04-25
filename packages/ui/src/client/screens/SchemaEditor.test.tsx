import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SchemaEditor } from "./SchemaEditor";
import type { ClefManifest } from "@clef-sh/core";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare let global: any;

const manifest: ClefManifest = {
  version: 1,
  environments: [
    { name: "dev", description: "Dev" },
    { name: "prod", description: "Prod", protected: true },
  ],
  namespaces: [{ name: "auth", description: "Auth" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
};

interface FetchSpec {
  schema?: { ok?: boolean; status?: number; body: unknown };
  schemaPut?: { ok?: boolean; status?: number; body: unknown };
  values?: { ok?: boolean; body: unknown };
}

function mockRoutes(spec: FetchSpec): jest.Mock {
  const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.match(/\/api\/namespaces\/[^/]+\/schema$/) && method === "GET") {
      const s = spec.schema ?? {
        ok: true,
        body: { attached: false, path: null, schema: { keys: {} } },
      };
      return {
        ok: s.ok !== false,
        status: s.status ?? 200,
        json: () => Promise.resolve(s.body),
      } as Response;
    }
    if (url.match(/\/api\/namespaces\/[^/]+\/schema$/) && method === "PUT") {
      const s = spec.schemaPut ?? {
        ok: true,
        body: { attached: true, path: "schemas/auth.yaml", schema: { keys: {} } },
      };
      return {
        ok: s.ok !== false,
        status: s.status ?? 200,
        json: () => Promise.resolve(s.body),
      } as Response;
    }
    if (url.match(/\/api\/namespace\/[^/]+\/[^/]+$/) && method === "GET") {
      const s = spec.values ?? { ok: true, body: { values: {} } };
      return {
        ok: s.ok !== false,
        status: 200,
        json: () => Promise.resolve(s.body),
      } as Response;
    }
    throw new Error(`Unmocked fetch: ${method} ${url}`);
  });
  global.fetch = fetchMock;
  return fetchMock;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (global as any).fetch;
});

describe("SchemaEditor", () => {
  it("loads an attached schema and renders one row per key", async () => {
    mockRoutes({
      schema: {
        ok: true,
        body: {
          attached: true,
          path: "schemas/auth.yaml",
          schema: {
            keys: {
              API_KEY: { type: "string", required: true, pattern: "^sk_" },
              FLAG: { type: "boolean", required: false },
            },
          },
        },
      },
    });

    await act(async () => {
      render(<SchemaEditor ns="auth" manifest={manifest} />);
    });

    expect(screen.getByDisplayValue("API_KEY")).toBeInTheDocument();
    expect(screen.getByDisplayValue("FLAG")).toBeInTheDocument();
    expect(screen.getByDisplayValue("^sk_")).toBeInTheDocument();
  });

  it("shows the empty-state hint when the namespace has no schema yet", async () => {
    mockRoutes({});
    await act(async () => {
      render(<SchemaEditor ns="auth" manifest={manifest} />);
    });
    expect(screen.getByText(/No keys declared yet/i)).toBeInTheDocument();
    // TopBar subtitle promises auto-create on save
    expect(screen.getByText(/saving will create one at schemas\/auth\.yaml/i)).toBeInTheDocument();
  });

  it("adds a new key row when '+ Add key' is clicked", async () => {
    mockRoutes({});
    await act(async () => {
      render(<SchemaEditor ns="auth" manifest={manifest} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add key" }));
    expect(screen.getByPlaceholderText("KEY_NAME")).toBeInTheDocument();
  });

  it("validates regex patterns inline against the preview env's sample value", async () => {
    mockRoutes({
      schema: {
        ok: true,
        body: {
          attached: true,
          path: "schemas/auth.yaml",
          schema: { keys: { API_KEY: { type: "string", required: true, pattern: "^sk_" } } },
        },
      },
      values: { ok: true, body: { values: { API_KEY: "sk_test_abc" } } },
    });
    await act(async () => {
      render(<SchemaEditor ns="auth" manifest={manifest} />);
    });
    await waitFor(() => {
      expect(screen.getByText(/matches sample value/)).toBeInTheDocument();
    });
  });

  it("shows a miss when the pattern doesn't match the sample", async () => {
    mockRoutes({
      schema: {
        ok: true,
        body: {
          attached: true,
          path: "schemas/auth.yaml",
          schema: { keys: { API_KEY: { type: "string", required: true, pattern: "^pk_" } } },
        },
      },
      values: { ok: true, body: { values: { API_KEY: "sk_test_abc" } } },
    });
    await act(async () => {
      render(<SchemaEditor ns="auth" manifest={manifest} />);
    });
    await waitFor(() => {
      expect(screen.getByText(/does not match sample/)).toBeInTheDocument();
    });
  });

  it("flags an invalid regex as a row error and disables Save", async () => {
    mockRoutes({});
    await act(async () => {
      render(<SchemaEditor ns="auth" manifest={manifest} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add key" }));
    fireEvent.change(screen.getByPlaceholderText("KEY_NAME"), { target: { value: "K" } });
    fireEvent.change(screen.getByPlaceholderText(/pattern: \^regex/), {
      target: { value: "([" },
    });
    expect(screen.getByText(/not a valid regex/i)).toBeInTheDocument();
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("flags duplicate key names", async () => {
    mockRoutes({});
    await act(async () => {
      render(<SchemaEditor ns="auth" manifest={manifest} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add key" }));
    fireEvent.click(screen.getByRole("button", { name: "+ Add key" }));
    const inputs = screen.getAllByPlaceholderText("KEY_NAME");
    fireEvent.change(inputs[0], { target: { value: "DUPE" } });
    fireEvent.change(inputs[1], { target: { value: "DUPE" } });
    expect(screen.getByText(/Duplicate key name/i)).toBeInTheDocument();
  });

  it("PUTs the schema on Save and shows a confirmation toast with the saved path", async () => {
    const fetchMock = mockRoutes({
      schemaPut: {
        ok: true,
        body: {
          attached: true,
          path: "schemas/auth.yaml",
          schema: { keys: { API_KEY: { type: "string", required: true } } },
        },
      },
    });
    await act(async () => {
      render(<SchemaEditor ns="auth" manifest={manifest} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add key" }));
    fireEvent.change(screen.getByPlaceholderText("KEY_NAME"), { target: { value: "API_KEY" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    const putCall = fetchMock.mock.calls.find(
      (c) => c[0].match(/\/api\/namespaces\/auth\/schema$/) && c[1]?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    const body = JSON.parse(putCall![1].body as string);
    expect(body.schema.keys.API_KEY).toMatchObject({ type: "string", required: true });
    await waitFor(() => {
      expect(screen.getByText(/Saved at .* · schemas\/auth\.yaml/)).toBeInTheDocument();
    });
  });

  it("surfaces a server-side error from the PUT", async () => {
    mockRoutes({
      schemaPut: { ok: false, status: 400, body: { error: "Boom", code: "INVALID_SCHEMA" } },
    });
    await act(async () => {
      render(<SchemaEditor ns="auth" manifest={manifest} />);
    });
    fireEvent.click(screen.getByRole("button", { name: "+ Add key" }));
    fireEvent.change(screen.getByPlaceholderText("KEY_NAME"), { target: { value: "K" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(screen.getByText("Boom")).toBeInTheDocument();
  });
});
