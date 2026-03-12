# clef update

Scaffold missing encrypted matrix files after adding namespaces or environments to `clef.yaml`.

## Syntax

```bash
clef update [options]
```

## Description

`clef update` reads the current `clef.yaml` manifest and creates any encrypted files that are declared in the matrix but do not yet exist on disk. It is the companion command to `clef init` for ongoing repository maintenance.

Use `clef update` whenever you edit `clef.yaml` to add new namespaces or new environments. It is safe to run multiple times — existing encrypted files are never modified or overwritten.

## When to use `clef update` vs `clef init`

| Situation                                            | Command to run |
| ---------------------------------------------------- | -------------- |
| Setting up a brand new repository                    | `clef init`    |
| A new developer cloning an existing repository       | `clef init`    |
| Added a new namespace or environment to `clef.yaml`  | `clef update`  |
| Re-scaffolding missing files after a matrix mismatch | `clef update`  |

`clef init` is for first-time setup. `clef update` is for keeping an existing setup in sync with a changed manifest.

## Flags

| Flag     | Type    | Default | Description                                           |
| -------- | ------- | ------- | ----------------------------------------------------- |
| `--json` | boolean | `false` | Output the result as JSON instead of formatted output |

## Examples

### Add a new namespace

```bash
# 1. Edit clef.yaml to add a new namespace
#    namespaces:
#      - name: notifications
#        description: Notification service secrets

# 2. Scaffold the missing files
clef update
```

```
✓ Scaffolded 3 missing file(s):
    notifications/dev.enc.yaml
    notifications/staging.enc.yaml
    notifications/production.enc.yaml

Run clef lint to verify the matrix is complete.
```

### Add a new environment

```bash
# 1. Edit clef.yaml to add a new environment
#    environments:
#      - name: canary
#        description: Canary deployment

# 2. Scaffold the missing files
clef update
```

```
✓ Scaffolded 3 missing file(s):
    database/canary.enc.yaml
    payments/canary.enc.yaml
    auth/canary.enc.yaml

Run clef lint to verify the matrix is complete.
```

### Nothing to scaffold

```bash
clef update
```

```
✓ Matrix is complete — no missing files.
```

## Notes

- `clef update` creates empty encrypted files with valid SOPS metadata. No key/value pairs are added. Use `clef set` or `clef import` to populate the new files.
- Running `clef lint` after `clef update` confirms that the matrix is complete and all new files are well-formed.
- `clef update` does not modify `clef.yaml`, `.sops.yaml`, or `.clef/config.yaml`.

## Related commands

- [`clef init`](/cli/init) — first-time setup for a new repository
- [`clef lint`](/cli/lint) — validate the matrix after scaffolding
- [`clef set`](/cli/set) — populate the newly created encrypted files
