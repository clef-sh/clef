# Schemas Overview

Schemas let you define the expected keys for each namespace: which keys are required, what type each value should be, and optional regex patterns for validation. They are the mechanism by which Clef catches configuration mistakes before they reach production.

## Why use schemas

Without schemas, the only guarantee Clef can provide is that your encrypted files exist and have valid SOPS metadata. With schemas, Clef can also tell you:

- A **required key is missing** — `DATABASE_URL` must exist in every environment for the `database` namespace, but it is absent in production
- A **type is wrong** — `DB_PORT` should be an integer, but someone set it to `"localhost"`
- A **pattern does not match** — `DATABASE_URL` should start with `postgres://`, but the value is `mysql://...`
- A **key is undeclared** — `LEGACY_DB_HOST` exists in the file but is not in the schema, which may indicate a stale secret that should be cleaned up

These checks run during `clef lint` and are shown inline in the UI editor's schema summary panel.

## How schemas work

1. You create a YAML schema file (e.g., `schemas/database.yaml`) that defines the expected keys for a namespace
2. You reference the schema in your manifest:

```yaml
namespaces:
  - name: database
    description: Database credentials
    schema: schemas/database.yaml
```

3. When `clef lint` runs, it decrypts each file in the `database` namespace and validates the key-value pairs against the schema
4. Missing required keys produce **errors** (which block commits via the pre-commit hook)
5. Undeclared keys and values exceeding limits produce **warnings** (informational, do not block)

## Schema file format

A schema is a YAML file with a single top-level key called `keys`. Each entry under `keys` defines one expected key:

```yaml
keys:
  DB_HOST:
    type: string
    required: true
    description: Database hostname
  DB_PORT:
    type: integer
    required: true
  DB_PASSWORD:
    type: string
    required: true
  DB_POOL_SIZE:
    type: integer
    required: false
    default: 10
    max: 100
  DB_SSL:
    type: boolean
    required: true
```

For a complete field-by-field reference, see the [Schema Reference](/schemas/reference).

## Schemas are optional

Schemas are entirely optional. A namespace without a `schema` field in the manifest is simply not validated. This means you can adopt schemas incrementally — start with your most critical namespaces and add schemas to others as your team's practices mature.

## Validation in the workflow

Schemas integrate into several parts of the Clef workflow:

| Surface         | What happens                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `clef lint`     | All files in schema-backed namespaces are validated. Errors and warnings are reported with fix commands.              |
| Pre-commit hook | The hook runs `clef lint`, which includes schema validation. Missing required keys block the commit.                  |
| UI editor       | The schema summary panel shows pass/fail status below the key table. Required keys are marked with an amber asterisk. |
| UI lint view    | Schema validation issues appear alongside matrix and SOPS issues with the same severity grouping and fix commands.    |

## Next steps

Learn every field available in a schema file.

[Next: Schema Reference](/schemas/reference)
