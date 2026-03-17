# clef pack

Pack an encrypted artifact for a service identity. The artifact is a JSON envelope with age-encrypted secrets that can be fetched by the Clef agent at runtime.

## Synopsis

```bash
clef pack <identity> <environment> -o <path>
```

## Description

`clef pack` decrypts scoped SOPS files, age-encrypts the merged values as a single blob to the service identity's per-environment public key, and writes a JSON artifact to a local file.

The artifact is language-agnostic — it can be consumed by the [Clef Agent](/guide/agent) running as a sidecar, Lambda Extension, or standalone process. Upload the artifact to any HTTP-accessible store (S3, GCS, etc.) using your existing CI tools.

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

### Upload to S3

```bash
clef pack api-gateway production -o ./artifact.json
aws s3 cp ./artifact.json s3://my-bucket/clef/api-gateway/production.json
```

### Pack in CI

```yaml
# GitHub Actions
- name: Pack secrets artifact
  env:
    CLEF_AGE_KEY: ${{ secrets.CLEF_DEPLOY_KEY }}
  run: |
    npx @clef-sh/cli pack api-gateway production \
      --output ./artifact.json
```

::: warning Do not commit artifacts
The generated file contains encrypted secrets. Add the output path to `.gitignore`. Generate artifacts in CI and upload them to your secrets store.
:::

::: info CI requires a deploy key
`clef pack` decrypts SOPS files before re-encrypting for the service identity. The CI runner needs a key that can decrypt the scoped namespaces — the same `CLEF_AGE_KEY` used with `clef exec`. The service identity's own private key is not used during packing.
:::

## Related commands

- [`clef service`](service.md) — manage service identities
- [`clef agent`](agent.md) — runtime secrets sidecar
- [`clef exec`](exec.md) — run a command with secrets injected (alternative for dev)
- [`clef export`](export.md) — print secrets as shell export statements
