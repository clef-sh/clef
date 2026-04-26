# Pack Backend Plugins

A pack backend is the destination `clef pack` writes secrets to. The default `json-envelope` backend writes the encrypted Clef artifact JSON to a local file. Plugins let you write to anywhere else — AWS Secrets Manager, AWS Parameter Store, GCP Secret Manager, Azure Key Vault, your own internal store — with a single `clef pack --backend <id>` invocation.

This guide walks through writing and publishing a third-party pack backend.

## When a pack plugin makes sense

The pack plugin model fits cleanly with one category of target and uneasily with another. Worth understanding the distinction before you write or adopt a plugin.

**Pack-friendly: cloud consumption surfaces.** AWS Parameter Store, AWS Secrets Manager, GCP Secret Manager, Azure Key Vault, Kubernetes `Secret` objects, ECS task definitions. These are read-mostly storage primitives that runtime services (Lambda, Cloud Run, GKE pods, ECS tasks) load secrets from natively. They expect to be populated from _somewhere_ — CI, IaC, a deploy pipeline. They have no opinion about source of truth. `clef pack --backend <cloud-target>` is the canonical workflow.

**Awkward fit: source-of-truth secret managers.** HashiCorp Vault, Doppler, Infisical, 1Password Connect, Akeyless, Bitwarden Secrets Manager. These products _position themselves_ as the boundary where secrets live, rotate, and get audited. Their docs and pricing pages frame the product as the system of record. Pushing secrets _into_ them from Clef implies "Clef is source of truth, X is sink" — which contradicts the architecture customers chose those products for. The narrow legitimate use is **bootstrapping** (seeding a new Vault cluster, disaster-recovery seed) where a git-tracked snapshot is genuinely useful. If you write a plugin in this category, document the bootstrap framing — don't position it as steady-state delivery.

If your target is a generic blob store (S3, GCS, Azure Blob), use the built-in `json-envelope` backend with a custom `PackOutput` rather than a separate plugin — you only need a plugin when the destination has its own API shape.

## Who this is for

- **Platform engineers** who want `clef pack` to deliver secrets to a cloud consumption surface their team already uses.
- **Vendor integrators** wanting to offer official Clef compatibility for a target that fits the pack-friendly category above.

If you're just choosing a backend, see [the `clef pack` command reference](/cli/pack.md) — picking a backend is `--backend aws-parameter-store`, no integration work required.

## Package naming convention

| Package name           | Where to use                                               |
| ---------------------- | ---------------------------------------------------------- |
| `@clef-sh/pack-<name>` | Official first-party backends (reserved for the Clef org)  |
| `clef-pack-<name>`     | Unscoped community backends                                |
| `@<scope>/<any-name>`  | Scoped community backends with a fully-custom package name |

Users select a backend by the short id: `clef pack --backend aws-parameter-store` resolves, in order, to `@clef-sh/pack-aws-parameter-store`, then `clef-pack-aws-parameter-store`. Users can also pass a fully-qualified package name: `clef pack --backend @acme/secrets-thing` imports exactly that package.

## What you publish

A single npm package that default-exports a `PackBackend` object.

### `package.json`

```json
{
  "name": "clef-pack-internal-store",
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

The example below targets a hypothetical internal HTTP secret store — a `POST <base-url>/secrets/<path>` endpoint with bearer-token auth. Compact enough to keep the focus on the `PackBackend` shape; substitute your own target's SDK or HTTP calls in real plugins. For production-grade examples that talk to real cloud APIs, see the [reference plugins](#reference-plugins) below.

```typescript
import type { PackBackend, BackendPackResult } from "@clef-sh/core";

const backend: PackBackend = {
  id: "internal-store",
  description: "Push secrets to our team's internal HTTP secret store",

  validateOptions(raw) {
    const opts = raw as { path?: string };
    if (!opts.path) {
      throw new Error("internal-store backend requires 'path' (pass via --backend-opt path=...)");
    }
  },

  async pack(req): Promise<BackendPackResult> {
    // Auth lives in env vars — ecosystem convention.
    const baseUrl = process.env.INTERNAL_STORE_URL;
    const token = process.env.INTERNAL_STORE_TOKEN;
    if (!baseUrl || !token) {
      throw new Error(
        "internal-store backend requires INTERNAL_STORE_URL and INTERNAL_STORE_TOKEN env vars",
      );
    }

    const opts = req.backendOptions as { path: string };

    // Decrypt the secrets via Clef's SOPS client — provided in req.services.
    // Do NOT implement your own decryption; go through the shared interface.
    // (Details elided — see the reference plugins for full code.)
    const secrets = await decryptViaSops(req);

    const res = await fetch(`${baseUrl}/secrets/${opts.path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ data: secrets }),
    });
    if (!res.ok) {
      throw new Error(`internal-store responded ${res.status}: ${await res.text()}`);
    }

    return {
      outputPath: "",
      keyCount: Object.keys(secrets).length,
      keys: Object.keys(secrets),
      namespaceCount: 1,
      artifactSize: 0,
      revision: Date.now().toString(),
      backend: "internal-store",
      details: { path: opts.path },
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

- `id` — short identifier surfaced to the user (`clef pack --backend <id>`). Must match the suffix of your package name so `--backend internal-store` resolves `clef-pack-internal-store` cleanly.
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

- **Environment variables** — for auth (AWS SDK chain, `GOOGLE_APPLICATION_CREDENTIALS`, your store's bearer token, etc.). Plugin reads directly from `process.env`. Nothing to configure on Clef's side.
- **`--backend-opt key=value`** (repeatable) — for invocation-specific options like target path, secret name, project id. Parsed by the CLI into `req.backendOptions` as `Record<string, string>`.

Example invocation:

```bash
clef pack api-gateway production \
  --backend internal-store \
  --backend-opt path=myapp/production
```

## Error conventions

- **Missing required options** → throw in `validateOptions`. Short, actionable message (`"internal-store backend requires 'path'"`).
- **Missing credentials / auth failure** → throw in `pack` with a message pointing to the env var. (`"INTERNAL_STORE_TOKEN is not set"`).
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

YOURBACKEND_URL=https://store.example.com YOURBACKEND_TOKEN=... \
  npx clef pack api-gateway production \
    --backend yourbackend \
    --backend-opt path=myapp/production
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
