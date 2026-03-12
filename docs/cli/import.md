# clef import

Bulk-import secrets from an existing file (`.env`, JSON, or YAML) into an encrypted SOPS file. Use `clef import` when migrating an existing project to Clef or when onboarding secrets from another system.

::: warning Always run `--dry-run` first
`clef import` writes encrypted values immediately. Run `clef import --dry-run` to preview exactly which keys will be imported, skipped, or overwritten before committing.
:::

## Syntax

```bash
clef import <namespace/environment> [source] [options]
```

## Arguments

| Argument                | Description                                         |
| ----------------------- | --------------------------------------------------- |
| `namespace/environment` | The target encrypted file (e.g. `payments/staging`) |
| `source`                | Path to the source file. Omit when using `--stdin`. |

## Supported Source Formats

Clef auto-detects the format from the file extension or content. You can override detection with `--format`.

### dotenv

```bash
# .env or .env.local
DB_HOST=localhost
DB_PORT=5432
export STRIPE_KEY=sk_test_abc   # 'export' prefix is stripped
API_URL="https://api.example.com"   # quotes are stripped
WEBHOOK_SECRET=abc123   # inline comment stripped
```

### JSON

```json
{
  "DB_HOST": "localhost",
  "DB_PORT": "5432",
  "STRIPE_KEY": "sk_test_abc"
}
```

Only string values are imported. Number, boolean, null, and object values are skipped with a warning.

### YAML

```yaml
DB_HOST: localhost
DB_PORT: "5432"
STRIPE_KEY: sk_test_abc
```

Only string values are imported. Non-string values are skipped with a warning.

## Flags

| Flag                            | Type    | Default | Description                                                                          |
| ------------------------------- | ------- | ------- | ------------------------------------------------------------------------------------ |
| `--format <dotenv\|json\|yaml>` | string  | auto    | Override format detection.                                                           |
| `--prefix <string>`             | string  | —       | Only import keys starting with this prefix (e.g. `DB_`).                             |
| `--keys <k1,k2,...>`            | string  | —       | Only import the specified keys (comma-separated).                                    |
| `--overwrite`                   | boolean | false   | Overwrite keys that already exist in the target file.                                |
| `--dry-run`                     | boolean | false   | Preview which keys would be imported, skipped, or overwritten. No encryption occurs. |
| `--stdin`                       | boolean | false   | Read source content from stdin instead of a file.                                    |
| `--repo`                        | string  | auto    | Path to the Clef repo root. Overrides auto-detection.                                |

## Exit Codes

| Code | Meaning                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| `0`  | Success, or dry run complete with no errors                                     |
| `1`  | Partial failure — some keys failed to encrypt (others may have succeeded)       |
| `2`  | Could not start — missing manifest, invalid target, file not found, parse error |

## Output Format

### Normal import

```
Importing to database/staging from .env...

  ✓  DB_HOST              imported
  ↷  STRIPE_KEY           skipped — already exists (use --overwrite)
  ✗  API_TOKEN            failed

Import complete: 1 imported, 1 skipped, 1 failed.
```

### Dry run

```
Dry run — nothing will be encrypted.
Previewing import to database/staging from .env...

  →  DB_HOST              would import
  ↷  STRIPE_KEY           would skip — already exists

Dry run complete: 1 would import, 1 would skip.
Run without --dry-run to apply.
```

## Examples

### Migrate from a .env file

```bash
# Preview first
clef import payments/staging .env --dry-run

# Apply
clef import payments/staging .env
```

### Migrate from a JSON secrets file

```bash
clef import database/production secrets.json --dry-run
clef import database/production secrets.json
```

### Read from stdin (1Password, AWS Secrets Manager, etc.)

```bash
# From 1Password CLI
op item get "Database Staging" --format json \
  | jq '{DB_HOST: .fields[] | select(.label=="host") | .value}' \
  | clef import database/staging --stdin --format json

# From AWS SSM Parameter Store
aws ssm get-parameters-by-path \
  --path "/myapp/staging/" \
  --with-decryption \
  --query 'Parameters[*].{key: Name, value: Value}' \
  | clef import payments/staging --stdin --format json
```

### Import only keys matching a prefix

```bash
clef import database/staging secrets.env --prefix DB_
```

### Import specific keys only

```bash
clef import payments/staging .env --keys STRIPE_KEY,STRIPE_WEBHOOK_SECRET
```

### Overwrite existing keys

```bash
clef import database/staging new-secrets.env --overwrite
```

## Security Notes

- Secret values are **never logged or displayed** in any output. Only key names appear.
- Values exist in memory only while being processed. They are never written to disk as plaintext.
- After a successful import, delete the source file if it contained plaintext secrets.

## Related Commands

- [`clef set`](/cli/set) — Set a single key interactively
- [`clef export`](/cli/export) — Export decrypted values as shell statements
- [`clef rotate`](/cli/rotate) — Re-encrypt files with a new key
