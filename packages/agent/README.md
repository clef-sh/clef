# @clef-sh/agent

Sidecar secrets agent for [Clef](https://clef.sh). Serves decrypted secrets over a localhost HTTP API (`127.0.0.1:7779`). Deploy as a container sidecar, a standalone daemon, or an AWS Lambda extension.

## Quick Start

### Docker

```bash
docker run --rm \
  -e CLEF_AGENT_SOURCE=https://my-bucket.s3.amazonaws.com/clef/api-gateway/production.age.json \
  -e CLEF_AGENT_AGE_KEY=AGE-SECRET-KEY-1... \
  ghcr.io/clef-sh/agent:latest
```

In KMS envelope mode, no age key is needed — the container's IAM role provides `kms:Decrypt` permission:

```bash
docker run --rm \
  -e CLEF_AGENT_SOURCE=https://my-bucket.s3.amazonaws.com/clef/api-gateway/production.age.json \
  ghcr.io/clef-sh/agent:latest
```

### Standalone Binary

```bash
curl -Lo clef-agent https://github.com/clef-sh/clef/releases/latest/download/clef-agent-linux-x64
chmod +x clef-agent
export CLEF_AGENT_SOURCE=https://my-bucket.s3.amazonaws.com/clef/api-gateway/production.age.json
./clef-agent
```

### npm

```bash
npm install @clef-sh/agent
npx clef-agent
```

## API

| Endpoint               | Auth   | Description                                        |
| ---------------------- | ------ | -------------------------------------------------- |
| `GET /v1/health`       | No     | Health check with revision and expiry status       |
| `GET /v1/ready`        | No     | Readiness probe (503 until first decrypt succeeds) |
| `GET /v1/secrets`      | Bearer | All secrets as key-value JSON                      |
| `GET /v1/secrets/:key` | Bearer | Single secret by key                               |
| `GET /v1/keys`         | Bearer | List available key names                           |

```bash
curl -H "Authorization: Bearer $CLEF_AGENT_TOKEN" http://127.0.0.1:7779/v1/secrets
```

## Configuration

All configuration is via environment variables. Provide either `SOURCE` (HTTP URL or file path) or the `VCS_*` fields to tell the agent where to fetch the packed artifact.

### Artifact Source

| Variable                     | Default | Description                                    |
| ---------------------------- | ------- | ---------------------------------------------- |
| `CLEF_AGENT_SOURCE`          | —       | HTTP URL or file path to a packed artifact     |
| `CLEF_AGENT_VCS_PROVIDER`    | —       | VCS provider (`github`, `gitlab`, `bitbucket`) |
| `CLEF_AGENT_VCS_REPO`        | —       | Repository (`org/repo`)                        |
| `CLEF_AGENT_VCS_TOKEN`       | —       | VCS authentication token                       |
| `CLEF_AGENT_VCS_IDENTITY`    | —       | Service identity name                          |
| `CLEF_AGENT_VCS_ENVIRONMENT` | —       | Target environment                             |
| `CLEF_AGENT_VCS_REF`         | —       | Git ref (branch/tag/sha)                       |
| `CLEF_AGENT_VCS_API_URL`     | —       | Custom VCS API base URL                        |

### Decryption

| Variable                  | Default | Description            |
| ------------------------- | ------- | ---------------------- |
| `CLEF_AGENT_AGE_KEY`      | —       | Inline age private key |
| `CLEF_AGENT_AGE_KEY_FILE` | —       | Path to age key file   |

Not needed for KMS envelope artifacts — the container's IAM role provides `kms:Decrypt` permission on the envelope key.

### Server

| Variable           | Default        | Description               |
| ------------------ | -------------- | ------------------------- |
| `CLEF_AGENT_PORT`  | `7779`         | HTTP listen port          |
| `CLEF_AGENT_TOKEN` | auto-generated | Bearer token for API auth |
| `CLEF_AGENT_ID`    | auto-generated | Unique agent instance ID  |

### Cache and Reliability

| Variable                | Default | Description                                                                                            |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `CLEF_AGENT_CACHE_TTL`  | `300`   | Max seconds to serve without a successful refresh. Set to `0` for JIT mode (decrypt on every request). |
| `CLEF_AGENT_CACHE_PATH` | —       | Disk cache directory for fallback during source outages                                                |

### Security

| Variable                | Default | Description                                                                                                                             |
| ----------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `CLEF_AGENT_VERIFY_KEY` | —       | Public key for artifact signature verification (base64 DER SPKI). When set, unsigned or incorrectly signed artifacts are hard-rejected. |

### Telemetry

| Variable                   | Default | Description                     |
| -------------------------- | ------- | ------------------------------- |
| `CLEF_AGENT_TELEMETRY_URL` | —       | OTLP endpoint URL for telemetry |

## Deployment Models

### Container Sidecar (Kubernetes / ECS)

Run the agent as a sidecar container in the same pod or task as your application. Your app reads secrets from `http://127.0.0.1:7779/v1/secrets`.

```yaml
# Kubernetes sidecar example
containers:
  - name: app
    image: my-app:latest
    env:
      - name: CLEF_AGENT_TOKEN
        value: "my-token"
  - name: clef-agent
    image: ghcr.io/clef-sh/agent:latest
    env:
      - name: CLEF_AGENT_SOURCE
        value: "https://my-bucket.s3.amazonaws.com/clef/api-gateway/production.age.json"
      - name: CLEF_AGENT_TOKEN
        value: "my-token"
    livenessProbe:
      httpGet:
        path: /v1/health
        port: 7779
    readinessProbe:
      httpGet:
        path: /v1/ready
        port: 7779
```

### Lambda Extension

The SEA binary auto-detects the Lambda environment and runs as an extension. Pre-built layer zips are attached to each [GitHub Release](https://github.com/clef-sh/clef/releases). See the [Lambda Extension docs](https://docs.clef.sh/guide/agent#lambda-extension) for setup instructions.

### Standalone Daemon

Run directly as a system service or background process. The agent handles SIGTERM/SIGINT for graceful shutdown.

## Security

- Binds exclusively to `127.0.0.1` — never `0.0.0.0`
- Timing-safe bearer token authentication
- DNS rebinding protection via Host header validation
- `Cache-Control: no-store` on all secrets endpoints
- No plaintext on disk — decrypted values exist only in process memory
- KMS envelope mode requires no static key — IAM role is the authentication

## Documentation

- [Runtime Agent guide](https://docs.clef.sh/guide/agent)
- [Service Identities guide](https://docs.clef.sh/guide/service-identities)
- [CLI pack reference](https://docs.clef.sh/cli/pack)

## License

MIT
