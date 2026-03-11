# Schema Reference

This page documents every field available in a Clef schema file. Schemas are YAML files that define expected keys for a namespace.

## File structure

A schema file has one top-level key: `keys`. Each entry under `keys` is a key name mapped to a definition object:

```yaml
keys:
  KEY_NAME:
    type: string | integer | boolean
    required: true | false
    description: "Human-readable description"
    pattern: "^regex$"
    default: value
    max: number
```

## Field reference

### `keys`

The top-level map. Each entry's name is the expected key name in the encrypted file.

| Field         | Type      | Required | Default | Description                                                                                                   |
| ------------- | --------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------- |
| `type`        | `string`  | Yes      | —       | The expected value type. Must be one of `"string"`, `"integer"`, or `"boolean"`.                              |
| `required`    | `boolean` | Yes      | —       | If `true`, `clef lint` reports an error when this key is missing from an encrypted file.                      |
| `description` | `string`  | No       | —       | Human-readable description of the key. Shown in the UI as a tooltip or inline annotation.                     |
| `pattern`     | `string`  | No       | —       | A regex pattern that the value must match. Only applies to `string` type keys.                                |
| `default`     | `any`     | No       | —       | A suggested default value. Informational; Clef does not auto-populate defaults.                               |
| `max`         | `number`  | No       | —       | Maximum numeric value. Only applies to `integer` type keys. Exceeding this produces a warning (not an error). |

## Type validation rules

### `string`

Any value passes type validation. If a `pattern` is specified, the value must match the regex.

```yaml
keys:
  DATABASE_URL:
    type: string
    required: true
    pattern: "^postgres://"
```

**Passes:** `postgres://user:pass@host:5432/db`
**Fails:** `mysql://user:pass@host:3306/db` (pattern mismatch)

### `integer`

The value must be parseable as a JavaScript integer (`Number.isInteger(Number(value))`).

```yaml
keys:
  DB_PORT:
    type: integer
    required: true
```

**Passes:** `5432`, `3306`, `0`
**Fails:** `abc`, `3.14`, `` (empty string)

With a `max` constraint:

```yaml
keys:
  DB_POOL_SIZE:
    type: integer
    required: false
    max: 100
```

**Passes:** `10`, `50`, `100`
**Warning:** `150` (exceeds max — this is a warning, not an error)

### `boolean`

The value must be exactly `"true"` or `"false"` (case-insensitive).

```yaml
keys:
  DB_SSL:
    type: boolean
    required: true
```

**Passes:** `true`, `false`, `True`, `FALSE`
**Fails:** `yes`, `1`, `on`

## Validation categories

Schema validation produces two categories of results:

### Errors (block commits)

| Rule       | Condition                                  | Example message                                                            |
| ---------- | ------------------------------------------ | -------------------------------------------------------------------------- |
| `required` | A required key is missing from the file    | `Required key 'DATABASE_URL' is missing.`                                  |
| `type`     | The value does not match the declared type | `Key 'DB_PORT' must be an integer, got 'abc'.`                             |
| `pattern`  | A string value does not match the regex    | `Key 'DATABASE_URL' value does not match required pattern '^postgres://'.` |

### Warnings (informational)

| Rule           | Condition                                      | Example message                                       |
| -------------- | ---------------------------------------------- | ----------------------------------------------------- |
| `undeclared`   | A key exists in the file but not in the schema | `Key 'LEGACY_DB_HOST' is not declared in the schema.` |
| `max_exceeded` | An integer value exceeds the `max` constraint  | `Key 'DB_POOL_SIZE' value 150 exceeds maximum 100.`   |

## Complete example

### Schema file

```yaml
# schemas/database.yaml
keys:
  DATABASE_URL:
    type: string
    required: true
    pattern: "^postgres://"
    description: PostgreSQL connection string
  DB_HOST:
    type: string
    required: true
    description: Database hostname
  DB_PORT:
    type: integer
    required: true
    description: Database port number
  DB_PASSWORD:
    type: string
    required: true
    description: Database password
  DB_POOL_SIZE:
    type: integer
    required: false
    default: 10
    max: 100
    description: Connection pool size
  DB_SSL:
    type: boolean
    required: true
    description: Whether to use SSL for database connections
```

### Passing file

An encrypted file (after decryption) with these values passes validation:

```yaml
DATABASE_URL: "postgres://user:pass@db.example.com:5432/mydb"
DB_HOST: "db.example.com"
DB_PORT: "5432"
DB_PASSWORD: "s3cur3p4ss"
DB_POOL_SIZE: "20"
DB_SSL: "true"
```

Result: **valid** — 0 errors, 0 warnings.

### Failing file

```yaml
DATABASE_URL: "mysql://user:pass@db.example.com:3306/mydb"
DB_HOST: "db.example.com"
DB_PORT: "not-a-number"
DB_POOL_SIZE: "150"
DB_SSL: "yes"
LEGACY_BACKUP_HOST: "old-db.example.com"
```

Result: **invalid** — 4 errors, 2 warnings:

| Severity | Key                  | Message                                              |
| -------- | -------------------- | ---------------------------------------------------- |
| Error    | `DATABASE_URL`       | Value does not match required pattern `^postgres://` |
| Error    | `DB_PORT`            | Must be an integer, got `not-a-number`               |
| Error    | `DB_PASSWORD`        | Required key is missing                              |
| Error    | `DB_SSL`             | Must be a boolean (`true` or `false`), got `yes`     |
| Warning  | `DB_POOL_SIZE`       | Value 150 exceeds maximum 100                        |
| Warning  | `LEGACY_BACKUP_HOST` | Not declared in the schema                           |

## Referencing a schema in the manifest

Link a schema to a namespace in `clef.yaml`:

```yaml
namespaces:
  - name: database
    description: Database credentials
    schema: schemas/database.yaml
  - name: payments
    description: Payment provider secrets
    # No schema — this namespace is not validated
```

The path is relative to the repository root.

## See also

- [Schemas Overview](/schemas/overview) — why and when to use schemas
- [clef lint](/cli/lint) — running schema validation
- [Manifest Reference](/guide/manifest) — linking schemas to namespaces
