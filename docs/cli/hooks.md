# clef hooks

Manage git hooks and the SOPS-aware merge driver for Clef.

## Syntax

```bash
clef hooks install
```

## Description

`clef hooks install` writes a pre-commit hook to `.git/hooks/pre-commit` that performs two checks before every commit:

1. **SOPS metadata validation** — Staged `*.enc.yaml` and `*.enc.json` files are checked for SOPS encryption headers (`"sops":` or `sops:`). If a file in the secret matrix is staged without valid SOPS metadata, the commit is rejected. This prevents the most common SOPS mistake: accidentally committing a plaintext secrets file.

2. **Secret scanning** — If validation passes and `clef` is on PATH, the hook runs `clef scan --staged` to detect plaintext secrets in all staged files. If potential secrets are found, the commit is blocked with a summary of findings.

If a pre-commit hook already exists, Clef asks for confirmation before overwriting it.

## Subcommands

### `clef hooks install`

Install the Clef pre-commit hook into the current repository.

## Examples

### Install the hook

```bash
clef hooks install
```

```
✓ Pre-commit hook installed
   ◌  .git/hooks/pre-commit
→  Hook checks SOPS metadata on staged .enc files and runs: clef scan --staged
✓ SOPS merge driver configured
```

### Hook already exists (Clef)

If a Clef hook already exists:

```bash
clef hooks install
```

```
A Clef pre-commit hook already exists. Overwrite? (y/N) y
✓ Pre-commit hook installed at .git/hooks/pre-commit
```

### Hook already exists (non-Clef)

If another tool's hook exists:

```bash
clef hooks install
```

```
A pre-commit hook already exists (not Clef). Overwrite? (y/N) n
ℹ Aborted. You can manually add Clef checks to your existing hook.
```

### Hook output on SOPS metadata failure

When you attempt to commit an unencrypted file:

```bash
git commit -m "update secrets"
```

```
ERROR: payments/production.enc.yaml appears to be missing SOPS metadata.
       This file may contain unencrypted secrets.
       Encrypt it with 'sops encrypt -i payments/production.enc.yaml' before committing.
```

### Hook output on secret scan failure

When `clef scan --staged` detects potential secrets:

```bash
git commit -m "add config"
```

```
clef scan found potential secrets in staged files.
Review the findings above before committing.
To bypass (use with caution): git commit --no-verify
```

## SOPS merge driver

`clef hooks install` also configures a SOPS-aware git merge driver, written to `.gitattributes` and `.git/config`, allowing git to merge encrypted files by decrypting, three-way merging, and re-encrypting automatically.

See [Merge Conflicts](/guide/merge-conflicts) for a detailed explanation of the problem and how the driver resolves it.

## Notes

- The hook and merge driver are installed automatically during `clef init`. Use `clef hooks install` to reinstall or set them up in an existing repo.
- Only errors prevent a commit — warnings do not block.
- `clef doctor` verifies that both the merge driver and pre-commit hook are configured correctly.

## Related commands

- [`clef init`](/cli/init) — automatically installs hooks and merge driver during initialisation
- [`clef scan`](/cli/scan) — the scan command that the hook runs on staged files
- [`clef doctor`](/cli/doctor) — checks that merge driver configuration is present
