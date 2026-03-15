# clef service

Manage service identities for serverless and machine workloads.

## Synopsis

```bash
clef service create <name> --namespaces <ns> [--description <desc>]
clef service list
clef service show <name>
clef service rotate <name> [-e <environment>]
clef service validate
```

## Description

Service identities are machine-oriented age key pairs scoped to specific namespaces. They enable serverless functions and containers to consume Clef-managed secrets at runtime without git or the `sops` binary. See [Service Identities](/guide/service-identities) for the full guide.

Each identity has a per-environment age key pair. The public key is registered as a SOPS recipient on the scoped encrypted files. The private key is stored in the target environment's secret manager (e.g. AWS Secrets Manager, HashiCorp Vault) — Clef never stores it.

## Subcommands

### create

Create a new service identity with per-environment age key pairs.

```bash
clef service create api-gateway \
  --namespaces api \
  --description "API gateway service"
```

This will:

1. Generate an age key pair for each declared environment
2. Add the identity to `clef.yaml` under `service_identities`
3. Register each public key as a SOPS recipient on scoped matrix files
4. Print the private keys to stdout **once**

::: warning
Private keys are printed once. Store them in your secret manager immediately. If lost, use `clef service rotate` to generate replacements.
:::

For multi-namespace identities, pass a comma-separated list:

```bash
clef service create backend-api \
  --namespaces api,database \
  --description "Backend API server"
```

### list

List all service identities declared in the manifest.

```bash
clef service list
```

Output:

```
Name          Namespaces    Environments
────────────  ────────────  ────────────────────────────────────
api-gateway   api           dev: age1…jn54khce, staging: age1…y9x8gf2t, production: age1…w0s3jn5
```

### show

Show details of a single service identity.

```bash
clef service show api-gateway
```

Output:

```
Service Identity: api-gateway
Description: API gateway service
Namespaces: api

  dev: age1…jn54khce
  staging: age1…y9x8gf2t
  production: age1…w0s3jn5
```

### rotate

Rotate the age key for a service identity. Generates new keys, swaps recipients on scoped SOPS files, and prints new private keys.

```bash
# Rotate all environments
clef service rotate api-gateway

# Rotate a specific environment
clef service rotate api-gateway -e production
```

After rotation:

1. Store the new private keys in your secret manager
2. Re-generate bundles with `clef bundle`
3. Redeploy the affected services
4. Commit the updated `clef.yaml`

### validate

Validate all service identity configurations against the manifest and encrypted files. Reports drift issues where the declared state in `clef.yaml` has diverged from the actual SOPS recipient state.

```bash
clef service validate
```

Drift issue types:

| Type                       | Severity | Description                                                      |
| -------------------------- | -------- | ---------------------------------------------------------------- |
| `namespace_not_found`      | error    | Identity references a namespace that does not exist in manifest  |
| `missing_environment`      | error    | Identity does not cover all declared environments                |
| `recipient_not_registered` | warning  | Identity's public key is missing from a scoped file's recipients |
| `scope_mismatch`           | warning  | Identity's key found as recipient outside its namespace scope    |

Errors cause exit code 1. Warnings alone exit 0.

## Flags

### create

| Flag                | Type   | Required | Default | Description                                 |
| ------------------- | ------ | -------- | ------- | ------------------------------------------- |
| `--namespaces <ns>` | string | Yes      | —       | Comma-separated namespace scopes            |
| `--description <d>` | string | No       | —       | Human-readable description for the identity |

### rotate

| Flag                      | Type   | Required | Default | Description                        |
| ------------------------- | ------ | -------- | ------- | ---------------------------------- |
| `-e, --environment <env>` | string | No       | —       | Rotate only a specific environment |

### Global

| Flag           | Type   | Default | Description              |
| -------------- | ------ | ------- | ------------------------ |
| `--dir <path>` | string | cwd     | Override repository root |

## Exit codes

| Code | Meaning                                  |
| ---- | ---------------------------------------- |
| 0    | Operation completed successfully         |
| 1    | Operation failed                         |
| 2    | Invalid input (identity not found, etc.) |

## Examples

### Full lifecycle

```bash
# Create
clef service create api-lambda --namespaces api --description "API Lambda"

# Store keys in AWS Secrets Manager
aws secretsmanager create-secret \
  --name clef/api-lambda/production \
  --secret-string "AGE-SECRET-KEY-1..."

# Commit
git add clef.yaml && git add -A && git commit -m "feat: add service identity 'api-lambda'"

# Generate a bundle (separate step, see clef bundle)
clef bundle api-lambda production --output ./dist/secrets.mjs

# Later: rotate production key
clef service rotate api-lambda -e production
```

## Related commands

- [`clef bundle`](bundle.md) — generate a runtime bundle for a service identity
- [`clef recipients`](recipients.md) — manage human recipient keys
- [`clef lint`](lint.md) — detects service identity drift issues
