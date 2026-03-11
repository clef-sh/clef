# clef diff

Compare decrypted secret values between two environments for a given namespace. Highlights changed keys, missing keys, and optionally identical keys.

## Syntax

```bash
clef diff <namespace> <env-a> <env-b> [options]
```

## Arguments

| Argument    | Description                                 |
| ----------- | ------------------------------------------- |
| `namespace` | The namespace to compare (e.g., `payments`) |
| `env-a`     | First environment (e.g., `dev`)             |
| `env-b`     | Second environment (e.g., `production`)     |

## Description

`clef diff` decrypts both files and produces a key-by-key comparison. Each key is classified as one of:

- **Changed** — the key exists in both environments but with different values
- **Missing in env-a** — the key exists in env-b but not env-a
- **Missing in env-b** — the key exists in env-a but not env-b
- **Identical** — the key exists in both with the same value (hidden by default)

When missing keys are found, Clef prints the exact `clef set` command needed to fill the gap.

The exit code reflects whether any differences exist, making `clef diff` usable in CI scripts.

## Flags

| Flag               | Type      | Default | Description                                                      |
| ------------------ | --------- | ------- | ---------------------------------------------------------------- |
| `--show-identical` | `boolean` | `false` | Include keys with identical values in the output                 |
| `--show-values`    | `boolean` | `false` | Show plaintext values instead of masking them                    |
| `--json`           | `boolean` | `false` | Output the raw `DiffResult` as JSON instead of a formatted table |

## Exit codes

| Code | Meaning                                           |
| ---- | ------------------------------------------------- |
| `0`  | No differences found between the two environments |
| `1`  | At least one key is changed or missing            |

## Examples

### Basic diff

```bash
clef diff payments dev production
```

```
payments: 2 changed, 1 missing in production

Key                  dev                  production           Status
STRIPE_SECRET_KEY    sk_test_abc123       sk_live_xyz789       changed
STRIPE_PUBLIC_KEY    pk_test_abc123       pk_live_xyz789       changed
WEBHOOK_SECRET       whsec_test123        (not set)            missing in production

ℹ Fix commands:
  clef set payments/production WEBHOOK_SECRET <value>
```

### Include identical keys

```bash
clef diff database dev staging --show-identical
```

```
database: 1 changed, 2 identical

Key          dev                            staging                        Status
DB_HOST      localhost                      staging-db.internal            changed
DB_PORT      5432                           5432                           identical
DB_PASSWORD  devpass123                     staging-secret                 identical
```

### JSON output for CI

```bash
clef diff payments dev staging --json
```

```json
{
  "namespace": "payments",
  "envA": "dev",
  "envB": "staging",
  "rows": [
    {
      "key": "STRIPE_SECRET_KEY",
      "valueA": "sk_test_abc123",
      "valueB": "sk_test_staging456",
      "status": "changed"
    },
    {
      "key": "STRIPE_PUBLIC_KEY",
      "valueA": "pk_test_abc123",
      "valueB": "pk_test_staging456",
      "status": "changed"
    }
  ]
}
```

### Use in CI pipelines

```bash
# Fail the pipeline if dev and staging have drifted
clef diff payments dev staging --json > /dev/null 2>&1
if [ $? -eq 1 ]; then
  echo "Secret drift detected between dev and staging"
  exit 1
fi
```

## Related commands

- [`clef set`](/cli/set) — fix missing keys identified by diff
- [`clef lint`](/cli/lint) — validate the entire repo, not just a single namespace
- [`clef get`](/cli/get) — retrieve an individual value for inspection
