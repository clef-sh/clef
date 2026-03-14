# clef merge-driver

SOPS-aware git merge driver for encrypted files. Handles merge conflicts on `.enc.yaml` files by decrypting both sides, merging the plaintext YAML, and re-encrypting the result.

## Syntax

```bash
clef merge-driver <base> <ours> <theirs>
```

## Description

Git merge drivers are called automatically during merges when two branches modify the same file. `clef merge-driver` is configured by `clef hooks install` via `.gitattributes` and `git config` — **you do not call it directly**.

When a merge touches an encrypted file, git passes three file paths to the driver:

- **base** — the common ancestor version (`%O`)
- **ours** — the current branch version (`%A`)
- **theirs** — the incoming branch version (`%B`)

The driver decrypts all three, performs a three-way merge on the plaintext YAML, and re-encrypts the resolved result into the `ours` path. Git then treats the file as resolved.

If a key has conflicting values in both branches that cannot be auto-resolved, the driver reports each conflict to stderr and exits with a non-zero code, leaving the conflict for manual resolution.

## Arguments

| Argument   | Description                                         |
| ---------- | --------------------------------------------------- |
| `<base>`   | Path to the common ancestor file (git's `%O` token) |
| `<ours>`   | Path to the current branch file (git's `%A` token)  |
| `<theirs>` | Path to the incoming branch file (git's `%B` token) |

## Configuration

The merge driver is registered automatically when you run `clef hooks install`. It sets the following in your local git config and `.gitattributes`:

```
# .gitattributes
*.enc.yaml merge=clef
```

```ini
# .git/config
[merge "clef"]
  name = Clef SOPS merge driver
  driver = clef merge-driver %O %A %B
```

## Exit Codes

| Code | Meaning                                                      |
| ---- | ------------------------------------------------------------ |
| `0`  | Merge resolved cleanly — re-encrypted result written to `%A` |
| `1`  | Conflict detected — manual resolution required               |

## Examples

### Automatic clean merge

Two branches each add a different key to `payments/production.enc.yaml`. On `git merge`, Clef resolves the conflict automatically:

```
Auto-merging payments/production.enc.yaml
Merge made by the 'ort' strategy.
```

### Conflict on the same key

Two branches modify `DB_HOST` to different values. The merge driver cannot auto-resolve this:

```
Merge conflict in encrypted file: 1 key(s) conflict
  DB_HOST:
    base:   db.old.internal
    ours:   db.new.internal
    theirs: db.other.internal
```

Resolve the conflict by choosing the correct value with `clef set`:

```bash
clef set payments/production DB_HOST db.new.internal
git add payments/production.enc.yaml
git merge --continue
```

## See also

- [`clef hooks`](/cli/hooks) — install the pre-commit hook and merge driver
- [Merge conflicts guide](/guide/merge-conflicts) — detailed walkthrough of conflict resolution
