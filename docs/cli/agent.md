# clef agent

Runtime secrets sidecar agent. Fetches an encrypted artifact, decrypts in memory, and serves secrets via a localhost HTTP API.

## Synopsis

```bash
clef agent start [options]
```

## Description

The Clef agent runs as a sidecar process that polls an artifact from an HTTP URL or local file, decrypts it using an age private key, and serves the decrypted secrets via a REST API on `127.0.0.1`.

The agent supports automatic secret rotation — when the source artifact is updated, the agent detects the new revision and performs an atomic cache swap. No application restart required.

See [Runtime Agent](/guide/agent) for the full guide, including Kubernetes and Lambda deployment models.

## Subcommands

### start

Start the agent sidecar.

```bash
clef agent start \
  --source https://bucket.s3.amazonaws.com/artifact.json \
  --port 7779
```

## Flags

| Flag                        | Type   | Default | Description                                     |
| --------------------------- | ------ | ------- | ----------------------------------------------- |
| `--source <url>`            | string | —       | HTTP URL or local file path (overrides env var) |
| `--port <port>`             | string | —       | HTTP API port (overrides env var)               |
| `--poll-interval <seconds>` | string | —       | Seconds between polls (overrides env var)       |

## Environment variables

| Variable                   | Default        | Description                             |
| -------------------------- | -------------- | --------------------------------------- |
| `CLEF_AGENT_SOURCE`        | (required)     | HTTP URL or local file path to artifact |
| `CLEF_AGENT_PORT`          | `7779`         | HTTP API port                           |
| `CLEF_AGENT_POLL_INTERVAL` | `30`           | Seconds between polls                   |
| `CLEF_AGENT_AGE_KEY`       | —              | Inline age private key                  |
| `CLEF_AGENT_AGE_KEY_FILE`  | —              | Path to age key file                    |
| `CLEF_AGENT_TOKEN`         | auto-generated | Bearer token for API auth               |

CLI flags override the corresponding environment variables.

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

### Start with environment variables

```bash
export CLEF_AGENT_SOURCE=https://my-bucket.s3.amazonaws.com/clef/api-gateway/production.json
export CLEF_AGENT_AGE_KEY=AGE-SECRET-KEY-1...
clef agent start
```

### Start with CLI flags

```bash
clef agent start \
  --source ./artifact.json \
  --port 8080 \
  --poll-interval 60
```

### Query secrets

```bash
curl -H "Authorization: Bearer $CLEF_AGENT_TOKEN" \
  http://127.0.0.1:7779/v1/secrets/DATABASE_URL
```

## Related commands

- [`clef pack`](pack.md) — pack an encrypted artifact for the agent to consume
- [`clef service`](service.md) — manage service identities
