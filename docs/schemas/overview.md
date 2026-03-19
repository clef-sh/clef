# Schemas Overview

Schemas define expected keys for each namespace — which are required, their types, and optional regex patterns — letting Clef catch configuration mistakes before they reach production.

## Why use schemas

Without schemas, Clef only guarantees that encrypted files exist with valid SOPS metadata. With schemas, it also catches:

- A **required key is missing** — `DATABASE_URL` must exist in every environment for the `database` namespace, but it is absent in production
- A **type is wrong** — `DB_PORT` should be an integer, but someone set it to `"localhost"`
- A **pattern does not match** — `DATABASE_URL` should start with `postgres://`, but the value is `mysql://...`
- A **key is undeclared** — `LEGACY_DB_HOST` exists in the file but is not in the schema, which may indicate a stale secret that should be cleaned up

Checks run during `clef lint` and appear inline in the UI editor's schema summary panel.

## How schemas work

1. Create a schema file (e.g., `schemas/database.yaml`) defining the expected keys
2. Reference it in the manifest:

```yaml
namespaces:
  - name: database
    description: Database credentials
    schema: schemas/database.yaml
```

3. `clef lint` decrypts each file and validates against the schema
4. Missing required keys → **errors** (block commits via the pre-commit hook)
5. Undeclared keys and exceeded limits → **warnings** (do not block)

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

Schemas are entirely optional — a namespace without a `schema` field is not validated. Adopt them incrementally, starting with the most critical namespaces.

## Validation in the workflow

Schemas integrate into several parts of the Clef workflow:

| Surface         | What happens                                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------- |
| `clef lint`     | All files in schema-backed namespaces are validated. Errors and warnings are reported with fix commands.              |
| Pre-commit hook | The hook runs `clef lint`, which includes schema validation. Missing required keys block the commit.                  |
| UI editor       | The schema summary panel shows pass/fail status below the key table. Required keys are marked with an amber asterisk. |
| UI lint view    | Schema validation issues appear alongside matrix and SOPS issues with the same severity grouping and fix commands.    |

## Next steps

[Schema Reference](/schemas/reference) — every field available in a schema file.
