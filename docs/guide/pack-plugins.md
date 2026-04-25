# Pack Backend Plugins

A pack backend is the destination `clef pack` writes secrets to. The default `json-envelope` backend writes the encrypted Clef artifact JSON to a local file. Plugins let you write to anywhere else — HashiCorp Vault, AWS Secrets Manager, Doppler, Infisical, your own internal store — with a single `clef pack --backend <id>` invocation.

This guide walks through writing and publishing a third-party pack backend.

## Who this is for

- **Platform engineers** who want `clef pack` to deliver secrets to a system their team already uses.
- **Vendor integrators** wanting to offer official Clef compatibility for a secrets store.

If you're just choosing a backend, see [the `clef pack` command reference](/cli/pack.md) — picking a backend is `--backend vault`, no integration work required.

## Package naming convention

| Package name           | Where to use                                               |
| ---------------------- | ---------------------------------------------------------- |
| `@clef-sh/pack-<name>` | Official first-party backends (reserved for the Clef org)  |
| `clef-pack-<name>`     | Unscoped community backends                                |
| `@<scope>/<any-name>`  | Scoped community backends with a fully-custom package name |

Users select a backend by the short id: `clef pack --backend vault` resolves, in order, to `@clef-sh/pack-vault`, then `clef-pack-vault`. Users can also pass a fully-qualified package name: `clef pack --backend @acme/secrets-thing` imports exactly that package.

## What you publish

A single npm package that default-exports a `PackBackend` object.

### `package.json`

```json
{
  "name": "clef-pack-vault",
  "version": "0.1.0",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "peerDependencies": {
    "@clef-sh/core": "^0.2.0"
  },
  "devDependencies": {
    "@clef-sh/core": "^0.2.0",
    "typescript": "^5.4.0"
  }
}
```

`@clef-sh/core` is a **peer dependency**, not a runtime dependency — there's one copy in the user's install, shared between the CLI and all plugins. Your plugin imports types from it only; there's nothing runtime-heavy to pull in.

### `src/index.ts`

```typescript
import type { PackBackend, BackendPackResult } from "@clef-sh/core";

const backend: PackBackend = {
  id: "vault",
  description: "HashiCorp Vault KV v2 backend",

  validateOptions(raw) {
    const opts = raw as { path?: string };
    if (!opts.path) {
      throw new Error("vault backend requires 'path' (pass via --backend-opt path=...)");
    }
  },

  async pack(req): Promise<BackendPackResult> {
    // Auth lives in env vars — ecosystem convention:
    //   VAULT_ADDR, VAULT_TOKEN (or AppRole via VAULT_ROLE_ID + VAULT_SECRET_ID)
    const vaultAddr = process.env.VAULT_ADDR;
    const vaultToken = process.env.VAULT_TOKEN;
    if (!vaultAddr || !vaultToken) {
      throw new Error("vault backend requires VAULT_ADDR and VAULT_TOKEN env vars");
    }

    const opts = req.backendOptions as { path: string; namespace?: string };

    // Decrypt the secrets via Clef's SOPS client — provided in req.services.
    // Do NOT implement your own decryption; go through the shared interface.
    // (Details elided — see the reference implementations on GitHub.)
    const secrets = await decryptViaSops(req);

    // Write to Vault via its HTTP API.
    await fetch(`${vaultAddr}/v1/${opts.path}`, {
      method: "POST",
      headers: {
        "X-Vault-Token": vaultToken,
        ...(opts.namespace ? { "X-Vault-Namespace": opts.namespace } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data: secrets }),
    });

    return {
      outputPath: "",
      keyCount: Object.keys(secrets).length,
      keys: Object.keys(secrets),
      namespaceCount: 1,
      artifactSize: 0,
      revision: new Date().toISOString(),
      backend: "vault",
      details: { path: opts.path, namespace: opts.namespace ?? null },
    };
  },
};

export default backend;
```

Must be the **default export**. The CLI resolver accepts ESM default, CJS-interop wrapped default, and bare CJS `module.exports` — but default is what consumers expect.

## The `PackBackend` interface

```typescript
interface PackBackend {
  readonly id: string;
  readonly description: string;
  validateOptions?(raw: Record<string, unknown>): void;
  pack(req: PackRequest): Promise<BackendPackResult>;
}
```

- `id` — short identifier surfaced to the user (`clef pack --backend <id>`). Must match the suffix of your package name so `--backend vault` resolves `clef-pack-vault` cleanly.
- `description` — one-line summary for help text and diagnostics.
- `validateOptions` — called before `pack`. Throw on invalid input; the error propagates to the CLI as a clean failure.
- `pack` — do the work, return a `BackendPackResult`.

The `PackRequest` fields you'll use:

- `req.identity` / `req.environment` — the target service identity and environment.
- `req.manifest` — parsed `clef.yaml`.
- `req.services.encryption` — SOPS client for decrypting scoped files.
- `req.services.kms` — KMS provider (undefined when the identity doesn't use KMS envelope encryption).
- `req.services.runner` — subprocess runner for spawning child processes.
- `req.ttl` — artifact TTL in seconds (optional).
- `req.backendOptions` — the `Record<string, string>` from `--backend-opt key=value` flags, plus any named-flag overrides. Narrow in `validateOptions`.

## How options flow

Pass-through options come from two channels:

- **Environment variables** — for auth (`VAULT_ADDR`, AWS SDK chain, `GOOGLE_APPLICATION_CREDENTIALS`, etc.). Plugin reads directly from `process.env`. Nothing to configure on Clef's side.
- **`--backend-opt key=value`** (repeatable) — for invocation-specific options like target path, secret name, project id. Parsed by the CLI into `req.backendOptions` as `Record<string, string>`.

Example invocation:

```bash
clef pack api-gateway production \
  --backend vault \
  --backend-opt path=secret/data/myapp/production \
  --backend-opt namespace=team-a
```

## Error conventions

- **Missing required options** → throw in `validateOptions`. Short, actionable message (`"vault backend requires 'path'"`).
- **Missing credentials / auth failure** → throw in `pack` with a message pointing to the env var. (`"VAULT_TOKEN is not set"`).
- **Destination-side errors** → surface the target system's error message. Don't swallow.
- **Decryption errors** → let them propagate. The shared SOPS client has consistent error types already.

Do **not** write plaintext secrets to logs or stderr. The CLI doesn't redact for you.

## Publishing

1. Build to CJS/ESM with a `.d.ts` file. Standard TypeScript library build.
2. Publish to npm under your chosen name.
3. Document the required env vars and `--backend-opt` keys in your README.
4. Include a short install + usage example:

```bash
npm install --save-dev clef-pack-yourbackend

VAULT_ADDR=https://vault.example.com VAULT_TOKEN=... \
  npx clef pack api-gateway production \
    --backend yourbackend \
    --backend-opt path=secret/myapp/production
```

## Testing your plugin

The minimal test pattern:

```typescript
import backend from "./index";
import type { PackRequest } from "@clef-sh/core";

function fakeRequest(): PackRequest {
  return {
    identity: "api-gateway",
    environment: "dev",
    manifest: {
      /* ... minimal manifest ... */
    },
    repoRoot: "/tmp/test-repo",
    services: {
      encryption: mockSopsClient(),
      runner: mockRunner(),
    },
    backendOptions: { path: "secret/test" },
  };
}

it("rejects missing 'path'", () => {
  expect(() => backend.validateOptions!({})).toThrow(/requires 'path'/);
});

it("writes the expected payload", async () => {
  const result = await backend.pack(fakeRequest());
  expect(result.backend).toBe("yourbackend");
  // ...
});
```

For integration testing against a real target system, spawn `clef pack --backend <id> --backend-opt ...` as a subprocess and verify the destination's state. See `integration/tests/pack-roundtrip.test.ts` in the Clef repo for the pattern.

## Compatibility

Plugins declare `@clef-sh/core` as a peer dependency with a semver range. Breaking changes to the `PackBackend` interface bump core's major version; update your plugin's peer range and republish.

The CLI performs a runtime shape check (`id: string`, `pack: function`) before invoking your backend. Plugins that don't satisfy the minimum shape are rejected with a clear error before `pack` is called.

## Reference plugins

- **[AWS Parameter Store](./pack-aws-parameter-store.md)** — `@clef-sh/pack-aws-parameter-store`. Source: [`packages/pack/aws-parameter-store`](https://github.com/clef-sh/clef/tree/main/packages/pack/aws-parameter-store). Use this as a worked example when writing your own backend.
- **[AWS Secrets Manager](./pack-aws-secrets-manager.md)** — `@clef-sh/pack-aws-secrets-manager`. Source: [`packages/pack/aws-secrets-manager`](https://github.com/clef-sh/clef/tree/main/packages/pack/aws-secrets-manager). Demonstrates dual emission modes (JSON-bundle and one-secret-per-key) and the `CreateSecret` → `PutSecretValue` upsert pattern.

## Reference

- Interface declarations: [`packages/core/src/pack/types.ts`](https://github.com/clef-sh/clef/blob/main/packages/core/src/pack/types.ts)
- Built-in backend implementation: [`packages/core/src/pack/backends/json-envelope.ts`](https://github.com/clef-sh/clef/blob/main/packages/core/src/pack/backends/json-envelope.ts)
- CLI resolver: [`packages/cli/src/pack-backends.ts`](https://github.com/clef-sh/clef/blob/main/packages/cli/src/pack-backends.ts)
