# Pending Values

Pending values solve the bootstrapping problem of setting up a namespace before real credentials are available. Without them you either block or use a plaintext placeholder like `CHANGEME` that's easy to forget.

## How it works

A **pending value** is a cryptographically random placeholder that occupies a key slot until the real secret is available. The file is valid and the matrix is complete from day one — the value is just flagged as unresolved until replaced.

### The lifecycle

1. **Scaffold with a random value** using `clef set <namespace/environment> <KEY> --random` or `clef init --random-values`
2. The key is encrypted normally and tracked as pending in a co-located `.clef-meta.yaml` file
3. The UI shows a `PENDING` badge, the matrix shows the pending count, `clef lint` reports pending warnings
4. When the real value is available, set it normally: `clef set <namespace/environment> KEY <value>` — the pending state clears automatically

### Scaffolding a new namespace

**At init time** — when the namespace has a schema, `clef init --random-values` populates all required keys with random placeholders in one step:

```bash
# Create random placeholders for all required schema keys
clef init --random-values

# Also scaffold optional keys
clef init --random-values --include-optional
```

**Incrementally** — without a schema, or to add individual keys after init:

```bash
clef set payments/staging STRIPE_SECRET_KEY --random
clef set payments/staging STRIPE_WEBHOOK_SECRET --random
```

**From the UI** — click `+ Add key`, switch to "Random (pending)" mode, and click "Generate random value". The value is generated server-side.

### Seeing what's pending

**CLI:**

```bash
clef lint
```

Pending keys appear as warnings:

```
⚠ [schema] payments/staging.enc.yaml → STRIPE_SECRET_KEY
  Value is a random placeholder — replace with the real secret.
  fix: clef set payments/staging STRIPE_SECRET_KEY
```

**Web UI:**

- The **Matrix View** shows a pending count next to the key count: `4 keys · 2 pending`
- The **Namespace Editor** shows pending rows with an amber `PENDING` badge and a `Set value` button
- The **Lint View** includes pending warnings in the warnings group

### Resolving pending values

Set the key normally — no special flag needed. The pending state clears automatically:

```bash
clef set payments/staging STRIPE_SECRET_KEY sk_live_abc123...
```

From the UI, click `Set value` on a pending row.

## The `.clef-meta.yaml` files

Pending state is tracked in a sidecar metadata file committed alongside each encrypted file:

```
database/
  dev.enc.yaml              ← encrypted values
  dev.clef-meta.yaml        ← pending state (plaintext)
  staging.enc.yaml
  staging.clef-meta.yaml
```

The `.clef-meta.yaml` file is plaintext and committed to the repo. It contains only key names and metadata — never secret values:

```yaml
# Managed by Clef. Do not edit manually.
version: 1
pending:
  - key: DATABASE_URL
    since: "2024-01-15T10:23:00.000Z"
    setBy: clef init --random-values
  - key: DATABASE_PASSWORD
    since: "2024-01-15T10:23:00.000Z"
    setBy: clef init --random-values
```

This lets the UI, lint runner, and CLI read pending state without decrypting the main file.

## FAQ

### Can I commit a repo with pending values?

Yes — pending values are properly encrypted random strings. Lint reports warnings (not errors), so commits are not blocked.

### What if I never replace a pending value?

It stays as a lint warning indefinitely. The placeholder is cryptographically secure but not a real secret.

### What format are random values?

64-character lowercase hex strings from `crypto.randomBytes(32)`.

### Can I see the random placeholder values?

Yes, with `clef get` or in the UI — but since they are meaningless placeholders, there's no reason to.
