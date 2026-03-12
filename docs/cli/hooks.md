# clef hooks

Manage git hooks and merge drivers for Clef. Provides the `install` subcommand for setting up the pre-commit hook and SOPS-aware merge driver.

## Syntax

```bash
clef hooks install
```

## Description

`clef hooks install` writes a pre-commit hook to `.git/hooks/pre-commit` that runs `clef lint` before every commit. If the lint check finds errors, the commit is blocked with an actionable error message.

The hook scans staged files for SOPS metadata markers. If a file in the secret matrix is staged without valid SOPS encryption headers, the commit is rejected. This prevents the most common SOPS mistake: accidentally committing a plaintext secrets file.

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
✓ Pre-commit hook installed at .git/hooks/pre-commit
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

### Hook output on lint failure

When you attempt to commit with lint errors:

```bash
git commit -m "update secrets"
```

```
Clef pre-commit check...

✗ 1 error(s)
  ✗ [schema] payments/production.enc.yaml WEBHOOK_SECRET
    Required key 'WEBHOOK_SECRET' is missing.
    fix: clef set payments/production WEBHOOK_SECRET <value>

Commit blocked — fix errors above and try again.
```

## SOPS merge driver

In addition to the pre-commit hook, `clef hooks install` configures a SOPS-aware git merge driver. This allows git to automatically merge encrypted files by decrypting them, performing a three-way merge on the plaintext, and re-encrypting the result.

The merge driver is configured in two places:

- **`.gitattributes`** — maps `*.enc.yaml` and `*.enc.json` files to the `sops` merge strategy
- **`.git/config`** — defines the `sops` merge driver command as `clef merge-driver %O %A %B`

Both are set up automatically by `clef init` and `clef hooks install`.

See [Merge Conflicts](/guide/merge-conflicts) for a detailed explanation of the problem and how the driver resolves it.

## Notes

- The hook and merge driver are installed automatically during `clef init`. Use `clef hooks install` to reinstall them or set them up in an existing repository.
- The hook runs `clef lint` which validates the entire repo, not just staged files. This ensures the commit does not introduce a broken state.
- The hook does not block on warnings — only errors prevent a commit.
- `clef doctor` verifies that both the merge driver and pre-commit hook are configured correctly.

## Related commands

- [`clef init`](/cli/init) — automatically installs hooks and merge driver during initialisation
- [`clef lint`](/cli/lint) — the validation command that the hook runs
- [`clef doctor`](/cli/doctor) — checks that merge driver configuration is present
