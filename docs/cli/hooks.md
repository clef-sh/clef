# clef hooks

Manage git hooks for Clef. Currently provides the `install` subcommand for setting up a pre-commit hook.

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

## Notes

- The hook is installed automatically during `clef init`. Use `clef hooks install` to reinstall it or set it up in an existing repository.
- The hook runs `clef lint` which validates the entire repo, not just staged files. This ensures the commit does not introduce a broken state.
- The hook does not block on warnings — only errors prevent a commit.

## Related commands

- [`clef init`](/cli/init) — automatically installs the hook during initialisation
- [`clef lint`](/cli/lint) — the validation command that the hook runs
