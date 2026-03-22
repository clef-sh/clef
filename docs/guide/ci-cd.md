# CI/CD Integration

`clef exec` is the recommended way to consume secrets in CI/CD pipelines. It decrypts values in memory, injects them as environment variables, and passes through the child process exit code.

## Choosing a CI backend

Before picking a pattern, understand the security tradeoff between the two supported backends:

|                              | age (private key)                                | AWS KMS / GCP KMS                         |
| ---------------------------- | ------------------------------------------------ | ----------------------------------------- |
| What the CI runner holds     | Long-lived private key + ciphertext              | Short-lived IAM token + ciphertext        |
| Master key location          | In the CI secret store, injected into the runner | Stays inside the KMS HSM — never leaves   |
| If the runner is compromised | Attacker gets a permanent key to all secrets     | Attacker gets a short-lived, scoped token |
| Revocation                   | Re-encrypt all files with a new key              | Remove the IAM permission — instant       |
| Audit log                    | None                                             | CloudTrail / Cloud Audit Logs             |

age is the simplest option. KMS adds short-lived credentials and audit logging at the cost of cloud infrastructure. See [age vs KMS](/guide/quick-start#age-vs-kms-choosing-an-encryption-backend).

---

## age — Simple Setup

Store the private key as a CI secret and pass it via `CLEF_AGE_KEY`. Clef passes it to SOPS automatically — no key file touches disk.

::: warning Security tradeoff
The age private key and ciphertext are both present in the runner simultaneously. A compromised runner exposes the key until rotation. Store `CLEF_AGE_KEY` in your CI provider's encrypted secrets store. See [age vs KMS](/guide/quick-start#age-vs-kms-choosing-an-encryption-backend).
:::

### GitHub Actions

```yaml
name: Deploy
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install Clef
        run: npm install -g @clef-sh/cli

      - name: Run deployment
        env:
          CLEF_AGE_KEY: ${{ secrets.AGE_PRIVATE_KEY }}
        run: clef exec payments/staging -- ./deploy.sh
```

The private key exists only in GitHub's secret store and in runner memory. Nothing touches disk.

### GitLab CI

```yaml
deploy:
  stage: deploy
  script:
    - clef exec payments/production -- ./deploy.sh
  variables:
    CLEF_AGE_KEY: $AGE_PRIVATE_KEY
  only:
    - main
```

Store `AGE_PRIVATE_KEY` as a masked, protected CI/CD variable in GitLab settings.

### CircleCI

```yaml
jobs:
  deploy:
    docker:
      - image: cimg/base:current
    steps:
      - checkout
      - run:
          name: Deploy
          environment:
            CLEF_AGE_KEY: $AGE_PRIVATE_KEY
          command: clef exec payments/production -- ./deploy.sh
```

Store `AGE_PRIVATE_KEY` as a CircleCI project or context variable. Set `CLEF_AGE_KEY` at the step level — job-level `environment` entries are literal strings, not expanded.

## AWS KMS — Zero-Secret Pattern

The runner's IAM role has `kms:Decrypt` permission. No long-lived secret is stored or passed.

### GitHub Actions with OIDC

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/clef-deploy
          aws-region: us-east-1

      - name: Deploy with secrets
        run: clef exec payments/production -- ./deploy.sh
```

**IAM policy for the deploy role:**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["kms:Decrypt"],
      "Resource": "arn:aws:kms:us-east-1:123456789012:key/your-key-id"
    }
  ]
}
```

This is the minimum permission needed.

## GCP KMS — Workload Identity Pattern

Same zero-secret approach. The runner authenticates via Workload Identity Federation.

### GitHub Actions with Workload Identity

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read
    steps:
      - uses: actions/checkout@v4

      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: projects/123/locations/global/workloadIdentityPools/pool/providers/github
          service_account: clef-deploy@my-project.iam.gserviceaccount.com

      - name: Deploy with secrets
        run: clef exec payments/production -- ./deploy.sh
```

The service account needs the `cloudkms.cryptoKeyVersions.useToDecrypt` permission on your KMS key.

## Multi-Namespace Exec

When a service needs secrets from multiple namespaces, use the `--also` flag:

```bash
clef exec database/production \
  --also auth/production \
  --also payments/production \
  -- node server.js
```

All namespaces are merged into one environment. Later `--also` targets override earlier ones for duplicate keys. Alternatively, chain `clef exec` calls:

```bash
clef exec database/production -- \
  clef exec auth/production -- \
  clef exec payments/production -- \
  node server.js
```

Use `--no-override` to keep earlier values when keys conflict — the primary target takes precedence:

```bash
clef exec database/production --also auth/production --no-override -- node server.js
```

### Prefix to avoid collisions

```bash
clef exec database/production --prefix DB_ -- \
  clef exec auth/production --prefix AUTH_ -- \
  node server.js
```

No collisions: database secrets become `DB_*` and auth secrets `AUTH_*`.

## Using `clef export` When Exec Is Not Possible

For CI systems that require environment variables set before the main script runs:

```bash
eval $(clef export payments/production --format env)
./deploy.sh
```

### Security caveat

With `eval`, decrypted values are briefly in the shell environment and readable from `/proc/<pid>/environ`. `clef exec` avoids this by spawning the child process directly. **Use `clef exec` whenever possible.**

### Docker build args

```bash
eval $(clef export app/production --format env)
docker build \
  --build-arg STRIPE_KEY="$STRIPE_KEY" \
  --build-arg DB_URL="$DATABASE_URL" \
  -t myapp .
```

Build args are visible in the image's build history. Use multi-stage builds to avoid leaking secrets into the final layer.

## Packed Artifacts + Runtime Agent

For serverless workloads that cannot run `sops` at deploy time, use [`clef pack`](/cli/pack) to create an encrypted artifact and the [runtime agent](/guide/agent) to serve secrets at runtime — instead of `clef exec`. Packed artifacts contain age-encrypted secrets in a JSON envelope — no git, no sops binary, no private keys in the deployment artifact. See the [Service Identities guide](/guide/service-identities) and [Agent guide](/guide/agent) for a full walkthrough.

## Best Practices

1. **Use `clef exec` over `clef export`** — subprocess injection never exposes secrets in shell state
2. **Scope CI permissions narrowly** — IAM roles should have `kms:Decrypt` only, on specific keys
3. **Use `--only` to limit exposure** — inject only the keys your command needs
4. **Test with `clef exec ... -- env`** — verify which variables are injected
