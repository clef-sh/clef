# clef pack

Pack an encrypted artifact for a service identity. The artifact is a JSON envelope with age-encrypted secrets that can be fetched by the Clef agent or runtime at deploy time.

## Synopsis

```bash
clef pack <identity> <environment> -o <path>
```

## Description

`clef pack` decrypts scoped SOPS files, age-encrypts the merged values as a single blob to the service identity's per-environment key, and writes a JSON artifact to a local file.

For **age-only** identities, the secrets are encrypted to the identity's persistent public key. For **KMS envelope** identities, the secrets are encrypted to an ephemeral public key, with the ephemeral private key wrapped by KMS and embedded in the artifact.

The artifact is language-agnostic — it can be consumed by the [Clef Agent](/guide/agent) running as a sidecar, Lambda Extension, or standalone process, or by [`@clef-sh/runtime`](/guide/agent#direct-import-nodejs) imported directly into a Node.js application.

See [Service Identities](/guide/service-identities) for the full guide.

## Arguments

| Argument        | Description                                                                         |
| --------------- | ----------------------------------------------------------------------------------- |
| `<identity>`    | Name of the service identity (must exist in `clef.yaml` under `service_identities`) |
| `<environment>` | Target environment (must be defined on the identity, e.g. `production`, `staging`)  |

## Flags

| Flag                  | Type   | Required | Default | Description                       |
| --------------------- | ------ | -------- | ------- | --------------------------------- |
| `-o, --output <path>` | string | Yes      | —       | Output file path for the artifact |
| `--dir <path>`        | string | No       | cwd     | Override repository root          |

## Exit codes

| Code | Meaning                                                |
| ---- | ------------------------------------------------------ |
| 0    | Artifact packed successfully                           |
| 1    | Pack failed (decryption error, missing identity, etc.) |

## Examples

### Pack an artifact

```bash
clef pack api-gateway production \
  --output ./artifact.json
```

### Deliver via VCS (default)

Commit the artifact to the repo. The runtime fetches it via the VCS API:

```yaml
# GitHub Actions
- name: Pack and commit
  env:
    CLEF_AGE_KEY: ${{ secrets.CLEF_DEPLOY_KEY }}
  run: |
    npx @clef-sh/cli pack api-gateway production \
      --output .clef/packed/api-gateway/production.age
    git add .clef/packed/
    git commit -m "chore: pack api-gateway/production" || echo "No changes"
    git push
```

### Deliver tokenless (S3)

Upload to an object store. The runtime fetches via HTTPS — no VCS token needed:

```yaml
# GitHub Actions
- name: Pack and upload
  env:
    CLEF_AGE_KEY: ${{ secrets.CLEF_DEPLOY_KEY }}
  run: |
    npx @clef-sh/cli pack api-gateway production \
      --output ./artifact.json
    aws s3 cp ./artifact.json \
      s3://my-secrets-bucket/clef/api-gateway/production.json
```

::: info CI requires a deploy key
`clef pack` decrypts SOPS files before re-encrypting for the service identity. The CI runner needs a key that can decrypt the scoped namespaces — the same `CLEF_AGE_KEY` used with `clef exec`. The service identity's own private key is not used during packing.
:::

## Related commands

- [`clef service`](service.md) — manage service identities
- [`clef exec`](exec.md) — run a command with secrets injected (alternative for dev)
- [`clef export`](export.md) — print secrets as shell export statements
