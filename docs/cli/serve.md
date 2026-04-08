# clef serve

Start a local secrets server for development. Packs and decrypts a service identity in memory, then serves secrets over HTTP — the same `GET /v1/secrets` contract used by the Clef agent and Cloud serve endpoint in production.

## Synopsis

```bash
clef serve --identity <name> --env <environment> [--port <port>]
```

## Description

`clef serve` bridges the gap between writing secrets locally and consuming them in your application. Instead of injecting environment variables (like `clef exec`), it starts an HTTP server that your app fetches secrets from at runtime — the same way it will in production.

The flow:

1. Reads the manifest and locates the service identity
2. Packs the identity's secrets for the specified environment (in memory, no disk I/O)
3. Decrypts the packed artifact using your local age key
4. Starts the agent HTTP server on `127.0.0.1`
5. Prints the URL, auth token, and a curl example
6. Blocks until you press Ctrl+C

Your app code calls `GET /v1/secrets` with a Bearer token and receives a JSON object of key-value pairs. This works identically whether the server is `clef serve` on localhost or a Cloud serve endpoint in production — only the URL changes.

::: info Protected environments are refused
`clef serve` will not serve secrets for protected environments (e.g. production). Use Clef Cloud for production secrets: `clef cloud init --env production`.
:::

## Flags

| Flag                      | Type   | Required | Default | Description                                  |
| ------------------------- | ------ | -------- | ------- | -------------------------------------------- |
| `-i, --identity <name>`   | string | Yes      | ---     | Service identity to serve                    |
| `-e, --env <environment>` | string | Yes      | ---     | Environment to serve (must not be protected) |
| `-p, --port <port>`       | number | No       | `7779`  | Port to listen on                            |
| `--dir <path>`            | string | No       | cwd     | Override repository root                     |

## Exit codes

| Code | Meaning                                                         |
| ---- | --------------------------------------------------------------- |
| 0    | Server stopped cleanly (Ctrl+C)                                 |
| 1    | Startup failed (missing identity, protected env, decrypt error) |

## Examples

### Basic usage

```bash
clef serve --identity api-gateway --env dev
```

Output:

```
  Serving 5 secrets for 'api-gateway/dev'

  URL:      http://127.0.0.1:7779/v1/secrets
  Token:    a1b2c3d4...
  Secrets:  5 keys from 2 namespace(s)
  Revision: 1711101600000-a1b2c3d4

  Example:
    curl -H "Authorization: Bearer a1b2c3d4..." http://127.0.0.1:7779/v1/secrets

  Press Ctrl+C to stop.
```

### Custom port

```bash
clef serve --identity api-gateway --env dev --port 8080
```

### Integration with npm scripts

Use a deterministic port so your app knows the URL at script-write time:

```json
{
  "scripts": {
    "dev": "concurrently \"clef serve -i api-gateway -e dev -p 7779\" \"npm run start:dev\"",
    "start:dev": "CLEF_SERVE_URL=http://127.0.0.1:7779 next dev"
  }
}
```

### Fetching secrets from your app

```typescript
const res = await fetch(`${process.env.CLEF_SERVE_URL}/v1/secrets`, {
  headers: { Authorization: `Bearer ${process.env.CLEF_SERVE_TOKEN}` },
});
const secrets = await res.json();
// { DB_HOST: "localhost", DB_PORT: "5432", STRIPE_KEY: "sk_test_..." }
```

The same code works in production — just point `CLEF_SERVE_URL` at your Cloud serve endpoint.

### Multiple service identities

Run one server per identity on different ports:

```bash
# Terminal 1
clef serve -i api-gateway -e dev -p 7779

# Terminal 2
clef serve -i auth-service -e dev -p 7780
```

Or use `concurrently` in a single script:

```json
{
  "scripts": {
    "dev:secrets": "concurrently \"clef serve -i api-gateway -e dev -p 7779\" \"clef serve -i auth-service -e dev -p 7780\""
  }
}
```

### Docker Compose

```yaml
services:
  api-secrets:
    image: node:22-slim
    command: npx @clef-sh/cli serve -i api-gateway -e dev -p 7779
    volumes:
      - .:/app
    working_dir: /app
    ports:
      - "7779:7779"
    environment:
      CLEF_AGE_KEY: ${CLEF_AGE_KEY}

  api:
    build: .
    environment:
      CLEF_SERVE_URL: http://api-secrets:7779
      CLEF_SERVE_TOKEN: # printed by clef serve on startup
    depends_on:
      - api-secrets
```

## Security

- The server binds to `127.0.0.1` only (localhost) — it is never exposed on the network
- Secrets exist only in memory — no plaintext is written to disk
- The auth token is auto-generated and printed once on startup
- Protected environments are refused to prevent accidental local exposure of production secrets
- The cache is wiped on shutdown (values zeroed before GC)

## How it relates to production

|            | Local (`clef serve`)               | Production (Cloud)                                  |
| ---------- | ---------------------------------- | --------------------------------------------------- |
| URL        | `http://127.0.0.1:7779/v1/secrets` | `https://int-abc123.serve.clef.sh/v1/secrets`       |
| Auth       | Auto-generated token               | Serve token (created via `clef cloud token rotate`) |
| Encryption | Age keys                           | Managed KMS                                         |
| Decryption | Local (your age key)               | Server-side (KMS)                                   |
| App code   | Identical                          | Identical                                           |

## Related commands

- [`clef pack`](pack.md) -- pack an artifact for deployment
- [`clef exec`](exec.md) -- run a command with secrets as env vars (alternative for dev)
- [`clef service`](service.md) -- manage service identities
- [`clef cloud`](cloud.md) -- managed Cloud backend for production
- [`clef agent`](agent.md) -- production sidecar agent
