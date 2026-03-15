# Merge Conflicts

When two developers change secrets on different branches, git cannot merge the encrypted files — even if the logical changes do not overlap. Clef solves this automatically with a custom SOPS-aware merge driver, configured by default during `clef init`.

## The problem

Imagine `database/production.enc.yaml` has three keys:

```yaml
# decrypted view (what humans see via clef)
DATABASE_URL: postgres://prod-db:5432/app
DATABASE_POOL_SIZE: 10
DATABASE_SSL: true
```

But what git actually stores is SOPS ciphertext — every value is an opaque encrypted blob, plus a whole-file MAC (message authentication code).

### What happens

Alice branches from main and increases the pool size:

```bash
git checkout -b feat/increase-pool
clef set database/production DATABASE_POOL_SIZE 25
git add database/production.enc.yaml
git commit -m "feat: increase DB pool to 25"
```

Bob branches from the same main and adds a timeout:

```bash
git checkout -b feat/add-timeout
clef set database/production DATABASE_TIMEOUT 30
git add database/production.enc.yaml
git commit -m "feat: add database timeout"
```

Both branches have valid, non-overlapping changes. In a normal YAML file, git would auto-merge these cleanly.

### Why it fails

SOPS re-encrypts **every value** in the file with a fresh random nonce whenever any value changes, and regenerates the MAC. So even `DATABASE_URL` — which neither Alice nor Bob touched — has completely different ciphertext in both branches.

When Bob tries to merge:

```bash
git checkout main
git merge feat/increase-pool   # merges cleanly (first one in)
git merge feat/add-timeout     # CONFLICT — every line differs
```

Every single line conflicts because the ciphertext is opaque. Git cannot tell that `DATABASE_URL` is semantically identical on both sides.

You cannot resolve this by hand: the encrypted blobs are meaningless to a human, and splicing lines together would produce an invalid MAC.

## How Clef solves it

Clef registers a custom [git merge driver](https://git-scm.com/docs/gitattributes#_defining_a_custom_merge_driver) during `clef init`. When git detects a conflict on an `.enc.yaml` or `.enc.json` file, it calls the Clef merge driver instead of its built-in text merge.

The driver:

1. **Decrypts** all three versions in memory — base (common ancestor), ours (current branch), theirs (incoming branch)
2. **Three-way merges** the plaintext key/value maps using the standard diff3 algorithm
3. If the merge is **clean** (no conflicting keys) — re-encrypts the merged result and writes it back. Git sees a successful merge.
4. If there is a **real conflict** (both sides changed the same key to different values) — reports the conflicting keys with their plaintext values so you can resolve them manually.

In the Alice/Bob example, the driver sees:

| Key                  | Base             | Ours (Alice)     | Theirs (Bob)     | Resolution        |
| -------------------- | ---------------- | ---------------- | ---------------- | ----------------- |
| `DATABASE_URL`       | `postgres://...` | `postgres://...` | `postgres://...` | Unchanged         |
| `DATABASE_POOL_SIZE` | `10`             | `25`             | `10`             | Take ours (Alice) |
| `DATABASE_SSL`       | `true`           | `true`           | `true`           | Unchanged         |
| `DATABASE_TIMEOUT`   | _(absent)_       | _(absent)_       | `30`             | Take theirs (Bob) |

Clean merge. The result is re-encrypted as a single valid SOPS file with all four keys and a fresh MAC.

## Setup

The merge driver is configured automatically by `clef init`. If you need to set it up manually (e.g., in an existing repository), run:

```bash
clef hooks install
```

This configures two things:

1. **`.gitattributes`** — tells git which files use the custom driver:

   ```
   *.enc.yaml merge=sops
   *.enc.json merge=sops
   ```

2. **`.git/config`** — tells git what command to run:
   ```ini
   [merge "sops"]
       name = SOPS-aware merge driver
       driver = clef merge-driver %O %A %B
   ```

You can verify the configuration with `clef doctor`, which checks for both pieces.

## When conflicts still happen

The merge driver resolves most merge scenarios automatically. A real conflict occurs only when both branches change **the same key** to **different values**:

```
Merge conflict in encrypted file: 1 key(s) conflict
  DATABASE_POOL_SIZE:
    base:   (has value)
    ours:   (has value)
    theirs: (has value)

Resolve conflicts manually with: clef set <namespace>/<env> <KEY> <value>
```

In this case, decide which value is correct and set it:

```bash
clef set database/production DATABASE_POOL_SIZE 50
git add database/production.enc.yaml
git commit
```

## Security

The merge driver maintains Clef's security invariants:

- **No plaintext to disk** — all three versions are decrypted in memory, merged in memory, and the result is piped through `sops encrypt` via stdin. No temporary plaintext files are created.
- **No custom crypto** — all encryption and decryption goes through the `sops` binary.
- **MAC integrity** — the re-encrypted file has a valid MAC generated by SOPS, not spliced from either branch.
