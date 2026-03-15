# Pending Values

Pending values solve a common bootstrapping problem: when you set up a new namespace, you often don't have the real credentials yet. The Stripe account isn't provisioned, the database isn't created, the third-party API key hasn't been issued.

Without pending values you either block on getting real credentials or put in a plaintext placeholder like `CHANGEME` which is easy to forget and never tracked.

## How it works

A **pending value** is a cryptographically random placeholder that occupies a key slot in an encrypted file until the real secret is available. The key is properly encrypted from day one — the file is valid, the schema passes, the matrix is complete — but the value is flagged as unresolved and tracked until it is replaced.

### The lifecycle

1. **Scaffold with a random value** using `clef set <namespace/environment> <KEY> --random` or `clef init --random-values`
2. The key is encrypted normally and tracked as pending in a co-located `.clef-meta.yaml` file
3. The UI shows a `PENDING` badge, the matrix shows the pending count, `clef lint` reports pending warnings
4. When the real value is available, set it normally: `clef set <namespace/environment> KEY <value>` — the pending state clears automatically

### Scaffolding a new namespace

There are two approaches to scaffolding pending values.

**At init time** — when the namespace has a schema, `clef init --random-values` populates all required keys with random placeholders across every environment in one step. This requires the `schema` field in the manifest to point to a valid schema file.

```bash
# Create random placeholders for all required schema keys
clef init --random-values

# Also scaffold optional keys
clef init --random-values --include-optional
```

**Incrementally** — when you don't have a schema, or when you need to add individual keys after init:

```bash
clef set payments/staging STRIPE_SECRET_KEY --random
clef set payments/staging STRIPE_WEBHOOK_SECRET --random
```

**From the UI** — click `+ Add key` in the Namespace Editor, switch to "Random (pending)" mode, enter the key name, and click "Generate random value". The random value is generated server-side and never leaves the API boundary.

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

Replace the random placeholder with the real secret:

```bash
clef set payments/staging STRIPE_SECRET_KEY sk_live_abc123...
```

Output:

```
✓ STRIPE_SECRET_KEY set in payments/staging
```

No special flag is needed — just set the key normally and the pending state clears automatically.

From the UI, click the `Set value` button on a pending row, enter the real value, and save.

## The `.clef-meta.yaml` files

Pending state is tracked in a sidecar metadata file committed alongside each encrypted file:

```
database/
  dev.enc.yaml              ← encrypted values
  dev.clef-meta.yaml        ← pending state (plaintext)
  staging.enc.yaml
  staging.clef-meta.yaml
```

The `.clef-meta.yaml` file is **plaintext and committed to the repo**. It contains **only key names and metadata, never secret values**:

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

This allows the UI, lint runner, and CLI to read pending state without decrypting the main file.

## FAQ

### Can I commit a repo with pending values?

Yes — that is the point. Pending values are properly encrypted random strings. The repo is in a valid state. Lint will report warnings (not errors) for pending keys, so commits are not blocked.

### What if I never replace a pending value?

It stays as a lint warning indefinitely. The random placeholder value is cryptographically secure and properly encrypted, so it's not a security risk — but it's not a real secret either.

### What format are random values?

Random values are 64-character lowercase hex strings generated from `crypto.randomBytes(32)`. They are cryptographically secure and long enough to be unguessable.

### Can I see the random placeholder values?

The random values are encrypted like any other secret. You can reveal them with `clef get` or in the UI — but since they are meaningless placeholders, there's no reason to.
