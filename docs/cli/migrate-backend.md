# clef migrate-backend

Migrate encrypted files from one SOPS backend to another. Decrypts each file with the current backend, re-encrypts with the new one, updates `clef.yaml`, and regenerates `.sops.yaml`.

## Syntax

```bash
clef migrate-backend <backend-flag> [options]
```

Exactly one backend flag is required:

```bash
clef migrate-backend --age
clef migrate-backend --aws-kms-arn <arn>
clef migrate-backend --gcp-kms-resource-id <id>
clef migrate-backend --azure-kv-url <url>
clef migrate-backend --pgp-fingerprint <fp>
```

## Description

Backend migration is a multi-phase operation:

1. **Validate** — verify the target environment exists and collect affected files
2. **Backup** — save copies of `clef.yaml`, `.sops.yaml`, and all encrypted files
3. **Update manifest** — write the new backend configuration to `clef.yaml`
4. **Regenerate `.sops.yaml`** — rebuild creation rules for the new backend
5. **Decrypt & re-encrypt** — decrypt each file with the old backend, re-encrypt with the new one
6. **Verify** — decrypt each migrated file to confirm it round-trips correctly

If any step fails, all changes are automatically rolled back to the pre-migration state.

## Flags

| Flag                         | Description                                 |
| ---------------------------- | ------------------------------------------- |
| `--age`                      | Migrate to age backend                      |
| `--aws-kms-arn <arn>`        | Migrate to AWS KMS with this key ARN        |
| `--gcp-kms-resource-id <id>` | Migrate to GCP KMS with this resource ID    |
| `--azure-kv-url <url>`       | Migrate to Azure Key Vault with this URL    |
| `--pgp-fingerprint <fp>`     | Migrate to PGP with this fingerprint        |
| `-e, --environment <env>`    | Scope migration to a single environment     |
| `--dry-run`                  | Preview changes without modifying any files |
| `--skip-verify`              | Skip post-migration verification step       |

## Exit codes

| Code | Meaning                                    |
| ---- | ------------------------------------------ |
| `0`  | Migration completed successfully           |
| `1`  | Migration failed (all changes rolled back) |

## Examples

### Migrate all environments to AWS KMS

```bash
clef migrate-backend --aws-kms-arn arn:aws:kms:us-east-1:123456:key/abcd-1234
```

### Preview a migration without making changes

```bash
clef migrate-backend --aws-kms-arn arn:aws:kms:us-east-1:123456:key/abcd-1234 --dry-run
```

### Migrate a single environment

```bash
clef migrate-backend --aws-kms-arn arn:aws:kms:us-east-1:123456:key/abcd-1234 -e production
```

This adds a per-environment backend override in `clef.yaml` rather than changing the global default.

### Migrate from KMS back to age

```bash
clef migrate-backend --age
```

### Rotate a KMS key (same backend, different key)

```bash
clef migrate-backend --aws-kms-arn arn:aws:kms:us-east-1:123456:key/new-key-id
```

Files already encrypted with the new key are skipped automatically.

## Web UI

The same operation is available in the local web UI under the **Backend** screen. Navigate to it from the sidebar to use a guided wizard with dry-run preview and protected environment confirmation.

## See also

- [`clef rotate`](/cli/rotate) — rotate age recipient keys (different from backend migration)
- [`clef init`](/cli/init) — choose the initial backend during repo setup
