# clef revoke

Revoke a packed artifact for a service identity. Overwrites the artifact with a revocation marker that the agent detects on the next poll, causing it to wipe its cache and stop serving secrets.

## Synopsis

```bash
clef revoke <identity> <environment>
```

## Description

`clef revoke` is the emergency brake for secrets access. It overwrites the packed artifact file (`.clef/packed/{identity}/{environment}.age.json`) with a minimal JSON marker containing a `revokedAt` timestamp. When the agent fetches this marker on its next poll, it wipes its in-memory and disk caches and returns 503 on all secrets endpoints.

Revocation takes effect within one poll cycle. The agent polls at `CLEF_AGENT_CACHE_TTL / 10` (default: every 30 seconds with a 300-second TTL).

To restore service after revocation, rotate your secrets and run `clef pack` to produce a new artifact. The agent will pick up the new artifact on the next poll and resume serving.

## Arguments

| Argument        | Description                                                                         |
| --------------- | ----------------------------------------------------------------------------------- |
| `<identity>`    | Name of the service identity (must exist in `clef.yaml` under `service_identities`) |
| `<environment>` | Target environment (must be defined on the identity, e.g. `production`, `staging`)  |

## Flags

| Flag           | Type   | Required | Default | Description              |
| -------------- | ------ | -------- | ------- | ------------------------ |
| `--dir <path>` | string | No       | cwd     | Override repository root |

## Exit codes

| Code | Meaning                                                  |
| ---- | -------------------------------------------------------- |
| 0    | Revocation marker written successfully                   |
| 1    | Failed (identity not found, environment not found, etc.) |

## Examples

### Emergency revocation

```bash
# 1. Revoke immediately
clef revoke api-gateway production

# 2. Commit and push so the agent picks it up
git add .clef/packed/api-gateway/production.age.json
git commit -m "revoke(api-gateway): compromised deploy token"
git push
```

### Automated revocation via CI

```yaml
# .github/workflows/revoke.yml
name: Revoke Secrets
on: workflow_dispatch
jobs:
  revoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npx @clef-sh/cli revoke api-gateway production
      - run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add .clef/packed/
          git commit -m "revoke(api-gateway): emergency revocation"
          git push
```

### Restore after revocation

```bash
# Rotate secrets, then repack
clef set api/production API_KEY new-key-value
clef pack api-gateway production \
  --output .clef/packed/api-gateway/production.age.json
git add .clef/packed/ api/production.enc.yaml
git commit -m "chore: rotate and repack api-gateway/production"
git push
```

### HTTP/S3 delivery

For agents that fetch via HTTP instead of VCS, upload the revoked artifact to the same location:

```bash
clef revoke api-gateway production
aws s3 cp .clef/packed/api-gateway/production.age.json \
  s3://my-secrets-bucket/clef/api-gateway/production.age.json
```

## Revocation timeline

| Step                              | Time         |
| --------------------------------- | ------------ |
| Run `clef revoke` + commit + push | ~30-60s      |
| Agent detects on next poll        | 1-30s        |
| **Total (manual)**                | **~1-2 min** |
| **Total (automated via CI)**      | **~10-30s**  |

With `CLEF_AGENT_CACHE_TTL=30` (polls every 3 seconds) and automated CI, revocation takes effect in under 15 seconds.

## How it works

The revoked artifact looks like:

```json
{
  "version": 1,
  "identity": "api-gateway",
  "environment": "production",
  "revokedAt": "2026-03-22T14:30:00.000Z"
}
```

When the agent fetches this response, it detects the `revokedAt` field and:

1. Wipes the in-memory secrets cache
2. Purges the disk cache (if configured)
3. Returns 503 on `/v1/secrets` and `/v1/keys`
4. Reports `{ ready: false, reason: "cache_expired" }` on `/v1/ready`

The same mechanism works for dynamic endpoints (Lambda, API Gateway) — the endpoint returns `revokedAt` in the response to deny access.

## Related commands

- [`clef pack`](pack.md) — pack a new artifact (also clears a prior revocation)
- [`clef service`](service.md) — manage service identities
- [`clef-agent`](agent.md) — agent configuration and API reference
