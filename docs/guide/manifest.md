# Manifest Reference

The manifest is a file called `clef.yaml` at the root of your Clef-managed repository. It declares the complete structure of your secrets: which namespaces exist, which environments exist, how encryption is configured, and where files live on disk.

Clef reads this file at the start of every operation. It is the backbone of the tool.

## Full annotated example

```yaml
# clef.yaml
version: 1

environments:
  - name: dev
    description: Local development
  - name: staging
    description: Staging environment
  - name: production
    description: Production environment
    protected: true

namespaces:
  - name: database
    description: Database credentials
    schema: schemas/database.yaml
  - name: payments
    description: Payment provider secrets
    owners:
      - payments-team
  - name: auth
    description: Auth and identity secrets

sops:
  default_backend: age

file_pattern: "{namespace}/{environment}.enc.yaml"
```

## Field reference

### Top-level fields

| Field          | Type     | Required | Default | Description                                                                                     |
| -------------- | -------- | -------- | ------- | ----------------------------------------------------------------------------------------------- |
| `version`      | `number` | Yes      | —       | Manifest schema version. Must be `1`.                                                           |
| `environments` | `array`  | Yes      | —       | List of deployment environments. At least one is required.                                      |
| `namespaces`   | `array`  | Yes      | —       | List of secret namespaces. At least one is required.                                            |
| `sops`         | `object` | Yes      | —       | SOPS encryption configuration.                                                                  |
| `file_pattern` | `string` | Yes      | —       | Template for encrypted file paths. Must contain `{namespace}` and `{environment}` placeholders. |

### Environment fields

Each entry in the `environments` array:

| Field         | Type      | Required | Default | Description                                                                                                                                                                                                              |
| ------------- | --------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`        | `string`  | Yes      | —       | Environment identifier. Used in file paths and CLI arguments. Must be unique.                                                                                                                                            |
| `description` | `string`  | Yes      | —       | Human-readable description. Shown in the UI.                                                                                                                                                                             |
| `protected`   | `boolean` | No       | `false` | If `true`, writes to this environment require explicit confirmation in the CLI and show a warning banner in the UI.                                                                                                      |
| `recipients`  | `array`   | No       | —       | Per-environment age recipient list. When set, only these recipients can decrypt this environment's files. See [Per-environment recipients](#per-environment-recipients) below.                                           |
| `sops`        | `object`  | No       | —       | Per-environment SOPS backend override. When set, this environment uses a different encryption backend than the global `sops.default_backend`. See [Per-environment SOPS override](#per-environment-sops-override) below. |

#### Per-environment recipients

An environment can declare its own list of age recipients. When set, only these recipients can decrypt the environment's files — the global recipient list in `sops.age.recipients` does not apply.

```yaml
environments:
  - name: dev
    description: Local development
  - name: production
    description: Production environment
    protected: true
    recipients:
      - key: "age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p"
        label: "ops-team"
      - "age1abc123..."
```

Each entry in the `recipients` array is either:

- A **string** — an age public key (`age1...`)
- An **object** with `key` (required, age public key) and `label` (optional, human-readable name)

Manage per-environment recipients with the `-e` flag:

```bash
clef recipients add age1abc... --label "Alice" -e production
clef recipients list -e production
clef recipients remove age1abc... -e production
```

`clef lint` detects recipient drift — when a file's actual recipients do not match the expected list declared in the manifest.

::: warning Per-environment recipients require the age backend
The `recipients` field is only valid on environments using the `age` backend (either explicitly or via the global default). Clef rejects the manifest if `recipients` is set on an environment with a non-age backend.
:::

#### Per-environment SOPS override

An environment can override the global SOPS backend by including a `sops` object. This is useful when different environments use different encryption providers (e.g., age for development, AWS KMS for production).

```yaml
environments:
  - name: dev
    description: Local development
  - name: production
    description: Production environment
    protected: true
    sops:
      backend: awskms
      aws_kms_arn: "arn:aws:kms:us-east-1:123456789:key/abcd-1234"
```

The `sops` object on an environment accepts:

| Field                 | Type     | Required      | Description                                                      |
| --------------------- | -------- | ------------- | ---------------------------------------------------------------- |
| `backend`             | `string` | Yes           | Encryption backend: `"age"`, `"awskms"`, `"gcpkms"`, or `"pgp"`. |
| `aws_kms_arn`         | `string` | When `awskms` | AWS KMS key ARN.                                                 |
| `gcp_kms_resource_id` | `string` | When `gcpkms` | GCP KMS key resource ID.                                         |
| `pgp_fingerprint`     | `string` | When `pgp`    | PGP key fingerprint.                                             |

When an environment has a `sops` override, Clef uses that backend for encryption instead of `sops.default_backend`. Environments without overrides continue to use the global default.

### Namespace fields

Each entry in the `namespaces` array:

| Field         | Type       | Required | Default | Description                                                                                                                    |
| ------------- | ---------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `name`        | `string`   | Yes      | —       | Namespace identifier. Used in file paths and CLI arguments. Must be unique.                                                    |
| `description` | `string`   | Yes      | —       | Human-readable description. Shown in the UI and lint output.                                                                   |
| `schema`      | `string`   | No       | —       | Relative path to a schema YAML file that defines expected keys for this namespace. See [Schema Reference](/schemas/reference). |
| `owners`      | `string[]` | No       | —       | List of team identifiers that own this namespace. Informational; shown in the UI.                                              |

### SOPS configuration fields

The `sops` object:

| Field                 | Type     | Required | Default | Description                                                         |
| --------------------- | -------- | -------- | ------- | ------------------------------------------------------------------- |
| `default_backend`     | `string` | Yes      | —       | Encryption backend: `"age"`, `"awskms"`, `"gcpkms"`, or `"pgp"`.    |
| `aws_kms_arn`         | `string` | No       | —       | AWS KMS key ARN. Used when `default_backend` is `"awskms"`.         |
| `gcp_kms_resource_id` | `string` | No       | —       | GCP KMS key resource ID. Used when `default_backend` is `"gcpkms"`. |
| `pgp_fingerprint`     | `string` | No       | —       | PGP key fingerprint. Used when `default_backend` is `"pgp"`.        |

::: tip age key path
When using the age backend, the private key path is stored in `.clef/config.yaml` on each developer's machine (gitignored) — not in the manifest. This keeps key locations personal and out of version control.
:::

### File pattern

The `file_pattern` field is a template string that determines where encrypted files live on disk. It must contain both `{namespace}` and `{environment}` placeholders.

Examples:

| Pattern                                      | Resulting path for `database/production` |
| -------------------------------------------- | ---------------------------------------- |
| `{namespace}/{environment}.enc.yaml`         | `database/production.enc.yaml`           |
| `secrets/{namespace}/{environment}.enc.yaml` | `secrets/database/production.enc.yaml`   |
| `config/{environment}/{namespace}.enc.yaml`  | `config/production/database.enc.yaml`    |

The default pattern generated by `clef init` is `{namespace}/{environment}.enc.yaml`.

## Validation

Clef validates the manifest on every load. The following conditions cause a validation error:

- `version` is missing or not `1`
- `environments` is empty
- `namespaces` is empty
- `file_pattern` is missing or does not contain both `{namespace}` and `{environment}`
- `sops.default_backend` is missing or not one of the supported values
- Duplicate environment or namespace names
- A `schema` path that does not point to a valid file (checked at lint time, not during manifest parsing)

## Creating the manifest

The easiest way to create a manifest is with `clef init`:

```bash
clef init --namespaces database,payments,auth --non-interactive
```

This generates a valid `clef.yaml` with sensible defaults. You can then edit it manually to add descriptions, schemas, owners, or change the file pattern.

## See also

- [Core Concepts](/guide/concepts) — how the manifest fits into the two-axis model
- [Schema Reference](/schemas/reference) — defining expected keys per namespace
- [clef init](/cli/init) — the CLI command that generates the manifest
- [clef lint](/cli/lint) — validates the manifest and all encrypted files
