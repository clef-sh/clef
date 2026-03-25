# @clef-sh/agent

Sidecar secrets agent for [Clef](https://clef.sh). Wraps `@clef-sh/runtime` in an HTTP API that serves decrypted secrets on `127.0.0.1:7779`. Deploy as a sidecar container, a daemon process, or an AWS Lambda extension.

## Install

```bash
npm install @clef-sh/agent
```

Or use the standalone binary (no Node.js required):

```bash
# Download from GitHub releases
curl -Lo clef-agent https://github.com/clef-sh/clef/releases/latest/download/clef-agent-linux-x64
chmod +x clef-agent
```

## Usage

```bash
# Point at an HTTP artifact source (S3, CDN, broker URL)
export CLEF_AGENT_SOURCE=https://my-bucket.s3.amazonaws.com/clef/api-gateway/production.age.json
export CLEF_AGENT_TOKEN=$(openssl rand -hex 32)

clef-agent
# Listening on http://127.0.0.1:7779
```

Your application reads secrets via HTTP:

```bash
curl -H "Authorization: Bearer $CLEF_AGENT_TOKEN" http://127.0.0.1:7779/v1/secrets
```

## API

| Endpoint               | Auth   | Description                                        |
| ---------------------- | ------ | -------------------------------------------------- |
| `GET /v1/health`       | No     | Health check with revision and expiry status       |
| `GET /v1/ready`        | No     | Readiness probe (503 until first decrypt succeeds) |
| `GET /v1/secrets`      | Bearer | All secrets as key-value JSON                      |
| `GET /v1/secrets/:key` | Bearer | Single secret by key                               |
| `GET /v1/keys`         | Bearer | List available key names                           |

## Security

- Binds exclusively to `127.0.0.1` — never `0.0.0.0`
- Timing-safe bearer token authentication
- DNS rebinding protection via Host header validation
- `Cache-Control: no-store` on all secrets endpoints
- KMS envelope mode requires no static age key — IAM role is the authentication

## Configuration

| Variable                     | Required | Default | Description                                   |
| ---------------------------- | -------- | ------- | --------------------------------------------- |
| `CLEF_AGENT_SOURCE`          | Yes\*    | —       | HTTP URL or file path to a packed artifact    |
| `CLEF_AGENT_VCS_PROVIDER`    | Yes\*    | —       | VCS provider (github, gitlab, bitbucket)      |
| `CLEF_AGENT_VCS_REPO`        | Yes\*    | —       | Repository (org/repo)                         |
| `CLEF_AGENT_VCS_TOKEN`       | Yes\*    | —       | VCS authentication token                      |
| `CLEF_AGENT_VCS_IDENTITY`    | Yes\*    | —       | Service identity name                         |
| `CLEF_AGENT_VCS_ENVIRONMENT` | Yes\*    | —       | Target environment                            |
| `CLEF_AGENT_PORT`            | No       | 7779    | HTTP listen port                              |
| `CLEF_AGENT_TOKEN`           | No       | auto    | Bearer token (auto-generated if not set)      |
| `CLEF_AGENT_AGE_KEY`         | No       | —       | Age private key (not needed for KMS envelope) |
| `CLEF_AGENT_CACHE_TTL`       | No       | 300     | Max seconds to serve without refresh          |

\_Provide either `SOURCE` or the `VCS\__` fields.

## Documentation

- [Runtime Agent guide](https://docs.clef.sh/guide/agent)
- [Service Identities guide](https://docs.clef.sh/guide/service-identities)
- [Dynamic Secrets guide](https://docs.clef.sh/guide/dynamic-secrets)

## License

MIT
