# Migrating to Clef

This guide walks you through migrating an existing project's secrets to Clef from common sources: `.env` files, JSON secrets files, and third-party secrets managers.

## Before you start

1. **Initialise a Clef repository** — if you haven't already, run `clef init` in your project root. See the [Quick Start](quick-start.md) guide.
2. **Verify your encryption key** — run `clef doctor` to confirm that `sops` is installed and that your key is configured.
3. **Dry-run everything** — use `--dry-run` on every `clef import` invocation before applying. It shows exactly what will happen without touching any encrypted file.

## Migrating from .env files

The most common migration path is from one or more `.env` files.

### Single environment

```bash
# Preview
clef import payments/staging .env --dry-run

# Apply
clef import payments/staging .env
```

### Multiple environments

If you have `.env.staging`, `.env.production`, etc.:

```bash
clef import payments/staging .env.staging --dry-run
clef import payments/staging .env.staging

clef import payments/production .env.production --dry-run
clef import payments/production .env.production
```

### Filtering by prefix

If a single `.env` file contains keys for multiple namespaces (a common pattern), use `--prefix` to split them:

```bash
# Import only database keys into the database namespace
clef import database/staging .env --prefix DB_

# Import only Stripe keys into the payments namespace
clef import payments/staging .env --prefix STRIPE_

# Import only auth keys
clef import auth/staging .env --prefix AUTH_ --prefix JWT_
```

### Handling non-string values

Dotenv values are always strings, so no values are skipped during dotenv import.

## Migrating from JSON secrets files

```bash
# secrets.json contains { "DB_HOST": "localhost", "DB_PORT": "5432" }
clef import database/staging secrets.json --dry-run
clef import database/staging secrets.json
```

Only string values are imported. Number, boolean, null, and object values are skipped with a warning. To include them, convert them to strings in the source file before importing.

## Migrating from YAML secrets files

```bash
clef import database/staging secrets.yaml --dry-run
clef import database/staging secrets.yaml
```

Same rules apply: only string values are imported.

## Migrating from third-party secrets managers

### 1Password CLI

```bash
# Export a 1Password item as environment variables
op item get "Database Staging" --format env | clef import database/staging --stdin
```

### AWS Secrets Manager

```bash
aws secretsmanager get-secret-value \
  --secret-id myapp/database/staging \
  --query SecretString \
  --output text \
  | clef import database/staging --stdin --format json
```

### HashiCorp Vault

```bash
vault kv get -format=json secret/myapp/staging \
  | jq '.data.data' \
  | clef import payments/staging --stdin --format json
```

### Doppler

```bash
doppler secrets download --no-file --format env \
  | clef import payments/staging --stdin
```

## Handling existing keys

By default, `clef import` skips keys that already exist in the target file. This is safe for repeated runs (idempotent by default).

To overwrite existing keys:

```bash
clef import database/staging .env --overwrite
```

To import only specific keys (useful when merging partial updates):

```bash
clef import database/staging .env --keys DB_PASSWORD,DB_HOST
```

## Verification checklist

After importing:

1. **Run lint** — `clef lint` confirms all matrix files are well-formed and complete.
2. **Spot-check a value** — `clef get database/staging DB_HOST` should return the expected value.
3. **Compare environments** — `clef diff database staging production` to confirm parity.
4. **Delete source files** — once you've verified all values are in Clef, delete any plaintext `.env` files from your repository.

```bash
git rm .env .env.staging .env.production
echo "*.env" >> .gitignore
git commit -m "chore: remove plaintext .env files — secrets now managed by Clef"
```

## Post-migration

Once all secrets are in Clef:

- Update CI/CD pipelines to use `clef exec` or `clef export` instead of sourcing `.env` files. See [CI/CD Integration](ci-cd.md).
- Update your `README` to point developers to `clef init` and the [Quick Start](quick-start.md).
- Add the pre-commit hook (`clef hooks install`) to prevent future plaintext commits.

## Related

- [`clef import`](/cli/import) — CLI reference
- [`clef set`](/cli/set) — Set individual keys interactively
- [`clef lint`](/cli/lint) — Validate the matrix after migration
