# clef-agent

Standalone runtime secrets sidecar. Fetches an encrypted artifact from a VCS provider, HTTP URL, or local file, decrypts in memory, and serves secrets via a localhost HTTP API.

## Synopsis

```bash
clef-agent
```

The agent is a standalone binary (or `npx @clef-sh/agent`), not a subcommand of `clef`. Configuration is via environment variables.

## Description

The Clef agent runs as a sidecar process that fetches a packed artifact, decrypts it, and serves the decrypted secrets via a REST API on `127.0.0.1`.

The agent supports two artifact delivery backends:

- **VCS** (recommended) — fetches the packed artifact directly from your git repository via the GitHub, GitLab, or Bitbucket API. Requires a VCS token.
- **HTTP/file** (tokenless) — fetches from any HTTPS URL (S3, GCS, etc.) or local file path. No VCS token needed.

The agent supports two encryption modes (determined by the artifact):

- **Age-only** — decrypts using a static age private key provided via `CLEF_AGENT_AGE_KEY`.
- **KMS envelope** — decrypts by calling KMS to unwrap an ephemeral key embedded in the artifact. No age key needed.

The agent supports automatic secret rotation — when the source artifact is updated, the agent detects the new revision and performs an atomic cache swap. No application restart required.

See [Runtime Agent](/guide/agent) for the full guide, including Kubernetes and Lambda deployment models.

## Environment variables

| Variable                     | Default        | Description                                        |
| ---------------------------- | -------------- | -------------------------------------------------- |
| `CLEF_AGENT_VCS_PROVIDER`    | —              | VCS provider (`github`, `gitlab`, or `bitbucket`)  |
| `CLEF_AGENT_VCS_REPO`        | —              | Repository (`owner/repo`)                          |
| `CLEF_AGENT_VCS_TOKEN`       | —              | VCS authentication token                           |
| `CLEF_AGENT_VCS_IDENTITY`    | —              | Service identity name                              |
| `CLEF_AGENT_VCS_ENVIRONMENT` | —              | Target environment                                 |
| `CLEF_AGENT_VCS_REF`         | default branch | Git ref (branch/tag/sha)                           |
| `CLEF_AGENT_VCS_API_URL`     | —              | Custom API URL (self-hosted instances)             |
| `CLEF_AGENT_SOURCE`          | —              | HTTP URL or local file path (alternative to VCS)   |
| `CLEF_AGENT_CACHE_PATH`      | —              | Disk cache path for VCS failure fallback           |
| `CLEF_AGENT_PORT`            | `7779`         | HTTP API port                                      |
| `CLEF_AGENT_POLL_INTERVAL`   | `30`           | Seconds between polls                              |
| `CLEF_AGENT_AGE_KEY`         | —              | Inline age private key (optional for KMS envelope) |
| `CLEF_AGENT_AGE_KEY_FILE`    | —              | Path to age key file (optional for KMS envelope)   |
| `CLEF_AGENT_TOKEN`           | auto-generated | Bearer token for API auth                          |

Either VCS config (`VCS_PROVIDER`, `VCS_REPO`, `VCS_TOKEN`, `VCS_IDENTITY`, `VCS_ENVIRONMENT`) **or** `SOURCE` is required.

Age key (`AGE_KEY` or `AGE_KEY_FILE`) is required for age-only artifacts, optional for KMS envelope artifacts.

## HTTP API

All endpoints are served on `127.0.0.1` only.

| Endpoint               | Auth         | Description                             |
| ---------------------- | ------------ | --------------------------------------- |
| `GET /v1/secrets`      | Bearer token | All secrets as JSON object              |
| `GET /v1/secrets/:key` | Bearer token | Single secret `{ "value": "..." }`      |
| `GET /v1/keys`         | Bearer token | Array of key names                      |
| `GET /v1/health`       | None         | `{ "status": "ok", "revision": "..." }` |
| `GET /v1/ready`        | None         | `200` if loaded, `503` if not           |

## Exit codes

| Code | Meaning                                            |
| ---- | -------------------------------------------------- |
| 0    | Agent stopped cleanly (SIGINT/SIGTERM)             |
| 1    | Startup failure (config error, unreachable source) |

## Examples

### VCS source with age key

```bash
export CLEF_AGENT_VCS_PROVIDER=github
export CLEF_AGENT_VCS_REPO=org/secrets
export CLEF_AGENT_VCS_TOKEN=ghp_...
export CLEF_AGENT_VCS_IDENTITY=api-gateway
export CLEF_AGENT_VCS_ENVIRONMENT=production
export CLEF_AGENT_AGE_KEY=AGE-SECRET-KEY-1...

clef-agent
```

### Tokenless with KMS envelope — minimal credentials

```bash
export CLEF_AGENT_SOURCE=https://my-bucket.s3.amazonaws.com/clef/api-gateway/production.json
# No VCS token, no age key — KMS envelope artifact uses IAM role

clef-agent
```

### Local file (development)

```bash
export CLEF_AGENT_SOURCE=./artifact.json
export CLEF_AGENT_AGE_KEY=AGE-SECRET-KEY-1...

clef-agent
```

### Query secrets

```bash
curl -H "Authorization: Bearer $CLEF_AGENT_TOKEN" \
  http://127.0.0.1:7779/v1/secrets/DATABASE_URL
```

## Related

- [`clef pack`](pack.md) — pack an encrypted artifact for the agent to consume
- [`clef service`](service.md) — manage service identities
