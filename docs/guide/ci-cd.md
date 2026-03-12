# CI/CD Integration

`clef exec` is the recommended way to consume secrets in CI/CD pipelines. It decrypts values in memory, injects them as environment variables into your command, and exits with the same exit code as the child process — making it a drop-in wrapper for any deployment step.

This page covers the most common CI/CD patterns with Clef. Every example is production-ready.

## Choosing a CI backend

Before picking a pattern, understand the security tradeoff between the two supported backends:

|                              | age (private key)                                | AWS KMS / GCP KMS                         |
| ---------------------------- | ------------------------------------------------ | ----------------------------------------- |
| What the CI runner holds     | Long-lived private key + ciphertext              | Short-lived IAM token + ciphertext        |
| Master key location          | In the CI secret store, injected into the runner | Stays inside the KMS HSM — never leaves   |
| If the runner is compromised | Attacker gets a permanent key to all secrets     | Attacker gets a short-lived, scoped token |
| Revocation                   | Re-encrypt all files with a new key              | Remove the IAM permission — instant       |
| Audit log                    | None                                             | CloudTrail / Cloud Audit Logs             |

**Use age for lower environments** (dev, staging) where operational simplicity matters and secrets are not production-critical.

**Use KMS for production.** The master key never leaves the HSM. CI authenticates via short-lived IAM credentials — nothing long-lived is stored or injected. If you can only use KMS for one environment, make it production.

---

## age — Simple Setup for Lower Environments

The simplest CI setup uses an age private key stored as a CI secret. SOPS reads the key from the `SOPS_AGE_KEY` environment variable automatically — no key file needs to touch disk.

::: warning Security tradeoff
The age private key and the ciphertext are both present in the CI runner simultaneously. A compromised runner exposes a long-lived key that grants access to everything it can decrypt until all secrets are rotated. For production secrets, use KMS instead.
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
          SOPS_AGE_KEY: ${{ secrets.AGE_PRIVATE_KEY }}
        run: clef exec payments/staging -- ./deploy.sh
```

**How it works:**

1. The age private key is stored in GitHub's encrypted secret store (`AGE_PRIVATE_KEY`)
2. GitHub Actions injects it into the runner's environment as `SOPS_AGE_KEY`
3. SOPS reads `SOPS_AGE_KEY` automatically when decrypting — no key file needed
4. `clef exec` decrypts the secrets in memory and passes them to `./deploy.sh`
5. When `deploy.sh` finishes, the runner is destroyed along with all secrets

The private key exists only in GitHub's secret store and in the runner's memory during the job. Nothing touches disk.

### GitLab CI

```yaml
deploy:
  stage: deploy
  script:
    - clef exec payments/production -- ./deploy.sh
  variables:
    SOPS_AGE_KEY: $AGE_PRIVATE_KEY
  only:
    - main
```

Store `AGE_PRIVATE_KEY` as a masked, protected CI/CD variable in GitLab project settings.

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
          command: clef exec payments/production -- ./deploy.sh
          environment:
            SOPS_AGE_KEY: $AGE_PRIVATE_KEY
```

Store `AGE_PRIVATE_KEY` as a CircleCI project environment variable or context variable in your CircleCI project settings.

## AWS KMS — Zero-Secret Pattern

The cleanest production setup. The CI runner's IAM role has `kms:Decrypt` permission on your SOPS KMS key. No secret needs to be stored or passed — identity-based access handles everything.

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

This is the minimum permission needed. The role can decrypt SOPS files but cannot encrypt, delete keys, or perform any other KMS operation.

## GCP KMS — Workload Identity Pattern

Same zero-secret approach for GCP. The CI runner authenticates via Workload Identity Federation and uses its service account's KMS permissions.

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

## Pattern B — Standalone Secrets Repository

When secrets live in a separate repository, pass its git URL directly to `--repo`. Clef clones and caches the repository automatically — no separate checkout step required.

### GitHub Actions — URL mode (recommended)

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Deploy with secrets
        env:
          SOPS_AGE_KEY: ${{ secrets.AGE_PRIVATE_KEY }}
          GIT_SSH_COMMAND: "ssh -i ${{ secrets.SECRETS_DEPLOY_KEY_PATH }}"
        run: |
          clef --repo git@github.com:acme/secrets.git \
               exec payments/production -- ./deploy.sh
```

Clef fetches the latest commit on each run, so secrets are always current. The runner needs SSH or token access to the secrets repo.

**Testing a feature branch against a matching secrets branch:**

```yaml
- name: Run tests with feature secrets
  env:
    SOPS_AGE_KEY: ${{ secrets.AGE_PRIVATE_KEY }}
  run: |
    clef --repo git@github.com:acme/secrets.git \
         --branch ${{ github.head_ref || 'main' }} \
         exec payments/staging -- npm test
```

When the secrets branch doesn't exist, `--branch` falls back to an error — make the fallback explicit in your CI config rather than relying on Clef to guess.

### GitLab CI — URL mode

```yaml
deploy:
  stage: deploy
  script:
    - clef --repo https://oauth2:${SECRETS_TOKEN}@gitlab.com/acme/secrets.git
      exec payments/production -- ./deploy.sh
  variables:
    SOPS_AGE_KEY: $AGE_PRIVATE_KEY
  only:
    - main
```

### Local Development with Pattern B

For local development where you need to write secrets (set, rotate, add recipients), clone the secrets repo alongside your application:

```bash
~/projects/
├── my-app/          # application code
└── acme-secrets/    # secrets repo (local clone for writes)
```

Then use `--repo` or a Makefile target:

```makefile
# Makefile
SECRETS_REPO ?= ../acme-secrets

.PHONY: dev
dev:
	clef --repo $(SECRETS_REPO) exec database/dev -- npm run dev

.PHONY: lint-secrets
lint-secrets:
	clef --repo $(SECRETS_REPO) lint
```

For read-only local use (just decrypting, not writing), the git URL form works too:

```bash
clef --repo git@github.com:acme/secrets.git get database/dev DB_URL
```

## Multi-Namespace Exec

When a service needs secrets from multiple namespaces, use the `--also` flag:

```bash
clef exec database/production \
  --also auth/production \
  --also payments/production \
  -- node server.js
```

All three namespaces are decrypted and merged into a single environment. For duplicate keys, later `--also` targets override earlier ones and the primary target.

Alternatively, chain `clef exec` calls (equivalent behaviour, but more verbose):

```bash
clef exec database/production -- \
  clef exec auth/production -- \
  clef exec payments/production -- \
  node server.js
```

To keep earlier values when keys conflict, use `--no-override`:

```bash
clef exec database/production --also auth/production --no-override -- node server.js
```

Now `database/production` values take precedence for any keys that appear in both namespaces.

### Prefix to avoid collisions

```bash
clef exec database/production --prefix DB_ -- \
  clef exec auth/production --prefix AUTH_ -- \
  node server.js
```

This guarantees no collisions: database secrets are `DB_*` and auth secrets are `AUTH_*`.

## Using `clef export` When Exec Is Not Possible

Some CI systems do not support subprocess wrapping — they require environment variables to be set before the main script runs. For these cases, use `clef export`:

```bash
eval $(clef export payments/production --format env)
./deploy.sh
```

### Security caveat

With `eval`, the decrypted values are briefly in the shell environment and visible to any process that reads `/proc/<pid>/environ` on Linux. `clef exec` does not have this exposure because it spawns the child process directly with the environment — no intermediate shell state.

**Use `clef exec` whenever possible. Use `clef export` only as a fallback.**

### Docker build args

One case where `clef export` is genuinely useful is injecting secrets as build-time arguments:

```bash
eval $(clef export app/production --format env)
docker build \
  --build-arg STRIPE_KEY="$STRIPE_KEY" \
  --build-arg DB_URL="$DATABASE_URL" \
  -t myapp .
```

Be cautious: build args are visible in the image's build history. Use multi-stage builds to avoid leaking secrets into the final image layer.

## Best Practices

1. **Use KMS for production secrets** — age keeps the private key and ciphertext together in the runner; KMS keeps the master key in an HSM and uses short-lived IAM credentials. This is not a style preference — it is the materially more secure choice for production.
2. **Use `clef exec` over `clef export`** — subprocess injection is more secure than shell eval; secrets never appear in intermediate shell state
3. **Scope CI permissions narrowly** — IAM roles should have `kms:Decrypt` only, on specific keys only
4. **Use `--only` to limit exposure** — inject only the keys your command actually needs
5. **Test with `clef exec ... -- env`** — quick way to verify which variables are being injected
