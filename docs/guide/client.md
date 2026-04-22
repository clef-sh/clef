# Client SDK

The `@clef-sh/client` package is a small, zero-dependency SDK for reading secrets from the Clef agent at runtime. It pairs with the [Runtime Agent](/guide/agent) — the agent serves secrets on `127.0.0.1:7779`; this client is how your application code consumes them.

## When to use the client SDK

Use `@clef-sh/client` when:

- Your application is Node.js / TypeScript and you want typed access to secrets served by the agent
- You want consistent secret-access semantics across container, Lambda, and local dev (via env-var fallback)
- You want an in-memory cache in front of the agent to avoid per-request HTTP calls

If your runtime is not Node.js, or your secrets are delivered to a native store via a [pack backend](/guide/pack-plugins) or a [CDK construct](/guide/cdk), you do not need this SDK — consume via the native store's client (AWS SDK, Vault agent, etc.) directly.

## Install

```bash
npm install @clef-sh/client
```

## Quick start

```typescript
import { ClefClient } from "@clef-sh/client";

const secrets = new ClefClient();

const dbUrl = await secrets.get("DB_URL");
const all = await secrets.getAll();
const names = await secrets.keys();
const isUp = await secrets.health();
```

With defaults the client reads:

- **Endpoint** from `CLEF_ENDPOINT`, falling back to `http://127.0.0.1:7779` (the agent's default bind)
- **Token** from `CLEF_SERVICE_TOKEN` (the bearer token the agent was configured with)

If both match your deployment, no constructor arguments are needed.

## Configuration

| Option        | Env var              | Default                 | Description                                                              |
| ------------- | -------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `endpoint`    | `CLEF_ENDPOINT`      | `http://127.0.0.1:7779` | Agent serve endpoint URL.                                                |
| `token`       | `CLEF_SERVICE_TOKEN` | —                       | Bearer token for agent auth. Throws if unset.                            |
| `envFallback` | —                    | `true`                  | When a key is not in the agent's payload, fall back to `process.env[K]`. |
| `cacheTtlMs`  | —                    | `0`                     | In-memory cache TTL (ms). `0` disables the client cache entirely.        |
| `fetch`       | —                    | `globalThis.fetch`      | Injectable fetch implementation for testing or non-Node runtimes.        |

Explicit constructor options always win over environment variables:

```typescript
new ClefClient({
  endpoint: "http://127.0.0.1:8080",
  token: process.env.CUSTOM_TOKEN,
  cacheTtlMs: 5_000,
});
```

## Env-var fallback

`envFallback: true` (default) means `secrets.get("DB_URL")` will return `process.env.DB_URL` if the agent's payload does not contain a `DB_URL` key. This is deliberate: local development can omit the agent entirely, set the same env vars the agent would have delivered, and the same call sites keep working.

Turn it off (`envFallback: false`) in contexts where the agent is the single source of truth — for example, production Lambda where a stray env var should never silently substitute for an agent value.

## Error handling

All agent-side errors surface as `ClefClientError`:

```typescript
import { ClefClient, ClefClientError } from "@clef-sh/client";

try {
  const secrets = new ClefClient();
  const value = await secrets.get("DB_URL");
} catch (err) {
  if (err instanceof ClefClientError) {
    console.error(err.message, { status: err.statusCode, fix: err.fix });
  }
  throw err;
}
```

Common error conditions:

- **No token configured** — thrown synchronously from the constructor. Set `CLEF_SERVICE_TOKEN` or pass `token:` explicitly.
- **Agent unreachable** — `health()` returns `false`; `get/getAll/keys` throw with the underlying HTTP error.
- **401 Unauthorized** — the token does not match what the agent was configured with.
- **503 Service Unavailable** — the agent is up but has not yet loaded an artifact. Typical during cold start; retry with backoff.

## Caching

By default the client does not cache — every `get()` is a fresh HTTP call to the agent, which itself serves from its in-memory cache. For workloads that read the same key many times per request, set `cacheTtlMs` to avoid the round-trip:

```typescript
const secrets = new ClefClient({ cacheTtlMs: 30_000 });
```

Caveat: the client's cache does not poll for rotations. If the agent refreshes the artifact mid-TTL, the client will continue to serve the pre-rotation value until the cache expires. Prefer short TTLs (seconds, not minutes) or leave caching off and rely on the agent's cache.

## Testing

Inject a custom `fetch` to avoid hitting the agent from unit tests:

```typescript
const stubFetch = async (url: string) =>
  new Response(JSON.stringify({ DB_URL: "postgres://fake" }), { status: 200 });

const secrets = new ClefClient({
  endpoint: "http://agent",
  token: "test-token",
  fetch: stubFetch as unknown as typeof globalThis.fetch,
});

expect(await secrets.get("DB_URL")).toBe("postgres://fake");
```

## Lambda and container patterns

**Lambda (with the agent as a Lambda extension layer):** the extension binds to `127.0.0.1:7779` within the execution environment, and the runtime sets `CLEF_ENDPOINT` and `CLEF_SERVICE_TOKEN` for the function via environment variables you configure on the function. The client's defaults pick both up automatically.

**Container (with the agent as a sidecar):** run the agent as a sidecar container in the same pod or task. Mount the shared token (via a Kubernetes secret, ECS Secrets Manager reference, or the orchestrator's native mechanism) into both containers as `CLEF_SERVICE_TOKEN`. The application container reaches the sidecar via `127.0.0.1:7779` when the pod shares a network namespace.

**Local dev:** either run the agent locally (`clef serve`) and the client connects to `127.0.0.1:7779` the same way it does in production, or export secrets to your shell (`clef exec`, `clef export`) and let `envFallback: true` serve them from `process.env` without the agent running.

## Cloud KMS provider

The package also exports a `CloudKmsProvider` for use with `@clef-sh/runtime` when artifacts are encrypted under Clef Cloud's managed KMS. This is a library integration, not an app-facing SDK.

```typescript
import { CloudKmsProvider } from "@clef-sh/client/kms";

const kms = new CloudKmsProvider({
  endpoint: "https://api.clef.sh",
  token: process.env.CLEF_SERVICE_TOKEN,
});
```

Pass the provider to the runtime when constructing it; the runtime will use it automatically when an artifact declares `envelope.provider === "cloud"`.

## API reference

Full typedoc-generated API reference: [`@clef-sh/client`](/api/client/src/).
