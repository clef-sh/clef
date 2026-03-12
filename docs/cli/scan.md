# clef scan

Scan the repository for secrets that have escaped the Clef matrix — plaintext secret values in files that are not SOPS-encrypted.

`clef scan` is distinct from `clef lint`. Lint validates the structure of your Clef-managed files. Scan looks for secrets that should be in Clef but are not.

## Syntax

```bash
clef scan [paths...] [flags]
```

## Flags

| Flag                 | Type        | Default | Description                                        |
| -------------------- | ----------- | ------- | -------------------------------------------------- |
| `--staged`           | boolean     | false   | Only scan files staged for commit                  |
| `--severity <level>` | `all\|high` | `all`   | `all` = patterns + entropy; `high` = patterns only |
| `--json`             | boolean     | false   | Machine-readable JSON output                       |
| `--no-git`           | boolean     | false   | Scan all files regardless of `.gitignore`          |
| `--repo <path>`      | string      | cwd     | Override repository root                           |

## Exit codes

| Code | Meaning                                                      |
| ---- | ------------------------------------------------------------ |
| `0`  | No issues found                                              |
| `1`  | Issues found                                                 |
| `2`  | Scan could not complete (manifest missing, permission error) |

## Examples

**Basic scan:**

```bash
clef scan
```

**CI usage — patterns only, no false positives from entropy:**

```bash
clef scan --severity high
```

**Scan staged files (used by pre-commit hook):**

```bash
clef scan --staged
```

**Scan specific directories:**

```bash
clef scan src/ config/
```

**Machine-readable output:**

```bash
clef scan --json | jq '.matches[] | .file'
```

## Output

```
Scanning repository for unencrypted secrets...

✗ Unencrypted matrix file
  payments/staging.yaml — missing SOPS metadata
  fix: clef encrypt payments/staging

⚠ Pattern match: Stripe live key
  src/config/payment.ts:23
  sk_l••••••••
  fix: clef set payments/staging STRIPE_KEY

⚠ High entropy value (entropy: 5.2)
  .env:4
  DATABASE_PASSWORD=••••••••
  fix: clef set database/staging DATABASE_PASSWORD
  or suppress: add '# clef-ignore' to line 4 of .env

2 issues found in 847 files (1.2s)
```

## JSON output

```json
{
  "matches": [
    {
      "file": "src/config/payment.ts",
      "line": 23,
      "column": 14,
      "matchType": "pattern",
      "patternName": "Stripe live key",
      "preview": "sk_l••••••••"
    }
  ],
  "unencryptedMatrixFiles": ["payments/staging.yaml"],
  "filesScanned": 847,
  "filesSkipped": 23,
  "durationMs": 1204,
  "summary": "2 issues found"
}
```

## Suppressing false positives

**Inline suppression** — add `# clef-ignore` to the same line as the false positive:

```bash
# In any scanned file:
PUBLIC_KEY=age1qlzq... # clef-ignore
```

**`.clefignore` rules** — exclude files, directories, or pattern checks globally. See the [scanning guide](/guide/scanning) for full `.clefignore` syntax.

## Related commands

- [`clef lint`](/cli/lint) — validate matrix structure, schema, and SOPS integrity
- [`clef hooks`](/cli/hooks) — install the pre-commit hook that runs `clef scan --staged`
- [`clef doctor`](/cli/doctor) — check your environment including `.clefignore` presence
