# clef cloud

Manage the Clef Cloud backend -- managed KMS encryption for production without AWS knowledge.

## Synopsis

```bash
clef cloud init --env <environment>
clef cloud login
clef cloud status
```

## Description

Clef Cloud provides a managed KMS key for production encryption. Your dev and staging environments stay on age keys (free, local, no network calls). Production gets real KMS encryption with one command.

Cloud handles three things:

1. **Managed KMS key** -- provisioned per integration, accessed via Clef key ID. You never see AWS ARNs, IAM policies, or the KMS console.
2. **Artifact hosting** -- `clef pack --push` uploads packed artifacts to Cloud for serving.
3. **Serve endpoint** -- production workloads fetch secrets via `GET /v1/secrets` from a Cloud-hosted URL.

::: info Migration path out
Cloud is not a lock-in. Run `clef migrate-backend --env production --aws-kms-arn YOUR_OWN_KEY` to move to your own KMS key at any time. You were on KMS the whole time -- you just change whose.
:::

## Subcommands

### clef cloud init

Provision a managed KMS key and migrate an environment to Cloud.

```bash
clef cloud init --env production
```

**Flow:**

1. Opens your browser to `cloud.clef.sh` for authentication and payment
2. Polls for completion (device flow)
3. Downloads the keyservice binary (if not already bundled)
4. Decrypts all cells in the target environment using your current backend
5. Re-encrypts using the Cloud-managed KMS key
6. Updates the manifest with `cloud.integrationId`, `cloud.keyId`, and `sops.backend: cloud`

After init, your manifest will include:

```yaml
cloud:
  integrationId: int_abc123
  keyId: clef:int_abc123/production
environments:
  - name: production
    sops:
      backend: cloud
```

**Flags:**

| Flag              | Type   | Required | Default | Description              |
| ----------------- | ------ | -------- | ------- | ------------------------ |
| `-e, --env <env>` | string | Yes      | ---     | Environment to migrate   |
| `--dir <path>`    | string | No       | cwd     | Override repository root |

### clef cloud login

Authenticate with Clef Cloud. Use this on a new machine or to re-authenticate after token expiry.

```bash
clef cloud login
```

Opens your browser for authentication (same Cognito login as the dashboard). Stores credentials in `~/.clef/credentials.yaml` (mode 0600).

This is auth-only -- no provisioning, no payment. Use `clef cloud init` for first-time setup.

### clef cloud status

Show the current Cloud connection status.

```bash
clef cloud status
```

Displays:

- Integration ID and Key ID (if configured)
- Which environments use the Cloud backend
- Whether credentials are present and valid
- Keyservice binary location and source

## Examples

### First-time setup

```bash
# 1. Initialise Cloud for production
clef cloud init --env production

# 2. Verify the setup
clef cloud status

# 3. Secrets now encrypt/decrypt via managed KMS
clef set payments/production STRIPE_KEY sk_live_...
clef get payments/production STRIPE_KEY
```

### Pack and push to Cloud

```bash
# Pack locally, upload to Cloud for serving
clef pack api-gateway production --push
```

### Authenticate on a new machine

```bash
# Auth only (no provisioning)
clef cloud login

# Verify
clef cloud status
```

### Use in CI

```yaml
# .github/workflows/deploy.yml
- name: Pack and push
  env:
    CLEF_CLOUD_TOKEN: ${{ secrets.CLEF_CLOUD_TOKEN }}
  run: |
    npx @clef-sh/cli pack api-gateway production --push
```

::: info CI uses the keyservice
When the manifest has `backend: cloud`, CLI commands that encrypt or decrypt automatically spawn the keyservice binary. The keyservice proxies KMS operations through the Cloud API using `CLEF_CLOUD_TOKEN`. No AWS credentials needed in CI.
:::

## How it works

```
Developer machine / CI:
  clef set payments/production STRIPE_KEY sk_live_...
      |
  SopsClient detects Cloud-managed environment
      |
  Spawns: clef-keyservice --token <cloud_token>
      |
  SOPS encrypts data locally with DEK
      |
  SOPS calls gRPC: Encrypt(KmsKey, dek_plaintext)
      |
  keyservice: POST https://api.clef.sh/v1/cloud/kms/encrypt
      |
  Cloud API: validates token, calls AWS KMS Encrypt
      |
  Wrapped DEK flows back: Cloud -> keyservice -> SOPS
      |
  SOPS writes encrypted file. keyservice exits.
```

Secret values never leave your machine. Only the 32-byte DEK crosses the wire.

## Security

- Secret values never leave the developer's machine -- SOPS encrypts/decrypts locally
- Only the DEK (32-byte random key) crosses the wire as base64
- Cloud API authenticates every request via Cognito JWT
- Cloud validates key ARN belongs to the caller's team
- The keyservice binary binds to `127.0.0.1` only and is short-lived
- Credentials stored with mode `0600` (owner read/write only)

## Related commands

- [`clef serve`](serve.md) -- local development server (same URL contract as Cloud)
- [`clef pack`](pack.md) -- pack artifacts (use `--push` to upload to Cloud)
- [`clef migrate-backend`](migrate-backend.md) -- migrate between encryption backends
- [`clef exec`](exec.md) -- run a command with secrets as env vars
