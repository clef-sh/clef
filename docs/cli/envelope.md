# clef envelope

Inspect, verify, and decrypt packed artifacts produced by [`clef pack`](/cli/pack). Useful for debugging runtime issues without reading JSON by hand — figuring out why a Lambda extension is getting 503s, confirming a signature is valid, or spot-checking which keys actually made it into a pack.

## Synopsis

```bash
clef envelope inspect <source>...
clef envelope verify  <source> --signer-key <key>
clef envelope decrypt <source> --identity <path> [--reveal]
```

All three commands accept the same source formats: a local file path, an `s3://bucket/key` URL, or an `https://…` URL. S3 URLs use ambient AWS credentials (AWS_PROFILE, AWS_ROLE_ARN, instance role).

## Subcommands

### `clef envelope inspect`

Prints metadata for one or more packed artifacts — version, identity, environment, packedAt, revision, ciphertextHash, expiresAt, envelope provider, signature presence. No decryption key needed.

```bash
$ clef envelope inspect ./artifact.json
version:          1
identity:         aws-lambda
environment:      dev
packedAt:         2026-04-23T06:00:00.000Z  (6h ago)
revision:         1776880279983-24310ee5
ciphertextHash:   06ef4346…2869c  (verified)
ciphertext size:  1.9 KB  (base64 wire)
expiresAt:        2026-04-30T06:00:00.000Z  (in 6d)
revokedAt:        —
envelope:         age-only (no KMS wrap)
signature:        present (Ed25519)
```

Multi-source inspection prints each in order with a separator:

```bash
clef envelope inspect ./old.json ./new.json
```

Use `--json` (top-level flag) for machine-readable output — returns an array, one entry per source.

**Exit codes**

| Code | Meaning                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| `0`  | All sources fetched and parsed. Hash mismatch, expiry, revocation are reported. |
| `1`  | One or more sources failed to fetch or parse.                                   |

Note: `inspect` is strictly informational. A hash mismatch shows `(MISMATCH)` in the output but exits 0. Use `verify` when you need to fail CI on integrity.

### `clef envelope verify`

Single-source integrity and signature check with CI-gateable exit codes.

```bash
$ clef envelope verify ./artifact.json --signer-key ./signer.pub.pem
source:         ./artifact.json
ciphertextHash: OK
signature:      valid (Ed25519, signer matches --signer-key)
expiresAt:      in 6d
revokedAt:      —
overall:        PASS
```

**Flags**

| Flag                               | Type   | Description                                                                                                                                                       |
| ---------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--signer-key <pem\|path\|base64>` | string | Ed25519 or ECDSA public key. Accepts a PEM string (starts with `-----BEGIN`), an existing file path, or a base64-encoded DER SPKI blob. Precedence in that order. |

**Exit codes**

| Code | Meaning                                |
| ---- | -------------------------------------- |
| `0`  | Overall pass.                          |
| `1`  | Argument / source-fetch / parse error. |
| `2`  | Ciphertext hash mismatch.              |
| `3`  | Signature invalid.                     |

Expiry and revocation are reported but do not fail the command. If you need hard-fail on expiry, gate on the returned JSON (`clef envelope verify --json ...` → check `checks.expiry.status`).

### `clef envelope decrypt`

Reveals the contents of a packed artifact. **Default output is key names only** — values require `--reveal`.

```bash
# Safe default: lists key names, no values
$ clef envelope decrypt ./artifact.json --identity ~/.age/key.txt
API_KEY
DB_URL
REDIS_URL

# Reveal values — prints a warning to stderr before stdout
$ clef envelope decrypt ./artifact.json --identity ~/.age/key.txt --reveal
WARNING: plaintext will be printed to stdout. Shell history, terminal
scrollback, and any attached logging (tmux capture-pane, CI log collectors,
screen-recording) may retain it. Proceed only if this terminal and its
upstream captures are trusted.
API_KEY=sk_live_123
DB_URL=postgres://prod-db
REDIS_URL=redis://prod-cache
```

**Flags**

| Flag                | Type   | Description                                                                                                           |
| ------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| `--identity <path>` | string | Path to an age identity file. Overrides `CLEF_AGE_KEY_FILE` and `CLEF_AGE_KEY`. Ignored for KMS-enveloped artifacts.  |
| `--reveal`          | bool   | Reveal all secret values. Prints a warning to stderr before the first stdout byte; omitting this keeps values hidden. |

**Identity resolution** (age-only artifacts):

1. `--identity <path>` if set
2. `$CLEF_AGE_KEY_FILE` — path to an age identity file
3. `$CLEF_AGE_KEY` — inline AGE-SECRET-KEY-…

**KMS-enveloped artifacts** decrypt using ambient AWS credentials — `AWS_PROFILE`, `AWS_ROLE_ARN`, instance role, or the standard env vars. No `--kms-role` flag; use `aws sts assume-role` or `AWS_PROFILE=...` before invocation if you need a specific role.

**Exit codes**

| Code | Meaning                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------- |
| `0`  | Decrypt succeeded.                                                                                         |
| `1`  | Generic / bad args / source unreachable / unparseable JSON.                                                |
| `2`  | Ciphertext hash mismatch (short-circuits before any decrypt).                                              |
| `4`  | Key resolution failure — no identity configured, or decrypt returned no match. For KMS: KMS unwrap denied. |
| `5`  | Artifact is expired or revoked.                                                                            |

**Safety invariants**

- Values are never written to disk by the command itself. Redirecting stdout is the user's responsibility.
- The `--reveal` warning emits to stderr only **after** hash / expiry / key / decrypt all pass — so a user who Ctrl-C's on the warning never sees plaintext.

## Typical workflows

**"Why is my Lambda returning 503?"**

```bash
# Is the artifact where we think it is, and when was it packed?
clef envelope inspect s3://my-bucket/aws-lambda/dev.json
# → packedAt 7h ago, expiresAt yesterday → expired. Re-pack.
```

**"Gate CI on signature validity"**

```bash
clef envelope verify ./artifact.json --signer-key ./team-signer.pub.pem \
  || exit 1
```

**"What keys are actually in this artifact?"**

```bash
clef envelope decrypt ./artifact.json --identity ~/.age/key.txt
# → API_KEY missing from the list? The packer didn't include it.
```

**"Check a specific value without leaving it on screen"**

```bash
clef envelope decrypt ./artifact.json --identity ~/.age/key.txt --reveal \
  | grep '^DB_URL=' | head -1
```

## See also

- [`clef pack`](/cli/pack) — produces the artifacts this command reads
- [`clef serve`](/cli/serve) / [`clef agent`](/cli/agent) — runtime surfaces that consume the same artifacts
- [Service Identities](/guide/service-identities)
