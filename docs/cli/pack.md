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

| Flag                        | Type   | Required | Default | Description                                                                                                                                                   |
| --------------------------- | ------ | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `-o, --output <path>`       | string | Yes      | —       | Output file path for the artifact                                                                                                                             |
| `--ttl <seconds>`           | number | No       | —       | Artifact TTL — embeds an `expiresAt` timestamp. Also relevant for [dynamic secret patterns](/guide/dynamic-secrets#example-static-secrets-with-ttl-bounding). |
| `--signing-key <key>`       | string | No       | —       | Ed25519 private key for artifact signing (base64 DER PKCS8). Falls back to `CLEF_SIGNING_KEY` env var. Mutually exclusive with `--signing-kms-key`.           |
| `--signing-kms-key <keyId>` | string | No       | —       | KMS asymmetric signing key ARN/ID (ECDSA_SHA_256). Falls back to `CLEF_SIGNING_KMS_KEY` env var. Mutually exclusive with `--signing-key`.                     |
| `--dir <path>`              | string | No       | cwd     | Override repository root                                                                                                                                      |

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
      --output .clef/packed/api-gateway/production.age.json
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

### Pack with a TTL

Embed an expiry in the artifact. The agent rejects the artifact after the TTL expires:

```bash
clef pack api-gateway production \
  --output ./artifact.json \
  --ttl 3600  # expires in 1 hour
```

### Sign with Ed25519

Sign the artifact so the agent can verify provenance. Generate a keypair with `openssl`, store the private key as a CI secret, and configure the agent with the public key via `CLEF_AGENT_VERIFY_KEY`:

```bash
clef pack api-gateway production \
  --output ./artifact.json \
  --signing-key "$CLEF_SIGNING_KEY"
```

### Sign with KMS (ECDSA)

Use an asymmetric KMS key (ECC_NIST_P256) for signing. The CI runner needs `kms:Sign` permission on this key:

```bash
clef pack api-gateway production \
  --output ./artifact.json \
  --signing-kms-key arn:aws:kms:us-east-1:123456789012:key/abcd-1234
```

::: warning Signing key is not the envelope key
The `--signing-kms-key` is an **asymmetric** signing key (ECC_NIST_P256). It is separate from the **symmetric** KMS key used for envelope encryption. Do not use the same key for both.
:::

## Related commands

- [`clef revoke`](revoke.md) — emergency revocation of a packed artifact
- [`clef service`](service.md) — manage service identities
- [`clef exec`](exec.md) — run a command with secrets injected (alternative for dev)
- [`clef export`](export.md) — print secrets as shell export statements
