# Scanning for Secrets

`clef scan` is a failsafe. It catches secrets that escaped the Clef matrix — values that were hardcoded directly in source files, config files, or `.env` files instead of being managed through `clef set`.

## What clef scan detects

Detection works in two categories:

**Unencrypted Clef-managed files** — files that match your `file_pattern` in `clef.yaml` but are missing valid SOPS metadata. This means someone decrypted a file and committed the plaintext output, or created a matrix file manually without using Clef. These are errors: the file contains plaintext secrets that should be encrypted.

**Secret-looking values in arbitrary files** — scan reads every tracked file in the repository and looks for values that appear to be secrets using two methods: pattern matching and entropy detection.

## How pattern detection works

Clef maintains a list of known secret formats and matches them against each line of every scanned file:

| Pattern                      | Example                                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------- |
| AWS access key               | `AKIAIOSFODNN7EXAMPLE`                                                                             |
| Stripe live key              | `sk_live_4eC39HqLyjW...`                                                                           |
| Stripe test key              | `sk_test_4eC39HqLyjW...`                                                                           |
| GitHub personal access token | `ghp_16C7e42F292c6...`                                                                             |
| GitHub OAuth token           | `gho_16C7e42F292c6...`                                                                             |
| GitHub Actions token         | `ghs_16C7e42F292c6...`                                                                             |
| Slack token                  | `xoxb-2048-352-1234...`                                                                            |
| Private key header           | `-----BEGIN RSA PRIVATE KEY-----`, `-----BEGIN EC PRIVATE KEY-----`, `-----BEGIN PRIVATE KEY-----` |
| Generic API key              | `API_KEY=...`, `SECRET_KEY=...`, `ACCESS_TOKEN=...`, `AUTH_TOKEN=...`                              |
| Database URL                 | `postgres://user:pass@host/db`                                                                     |

Pattern matches are high-signal. A Stripe live key starting with `sk_live_` is almost certainly a secret. Pattern detection has a very low false positive rate.

## How entropy detection works

Shannon entropy measures how unpredictable the characters in a string are. Each additional bit of entropy means the next character is twice as hard to predict.

Think of it this way: the word `password` has low entropy because it follows predictable patterns — common English letters in a common sequence. The string `4xK9mQ2pLv8nR3wZ` has high entropy because each character is unpredictable — random letters, digits, and mixed case with no discernible pattern.

This is why `hunter2` would not trigger entropy detection but `4xK9mQ2pLv8nR3wZ` would.

Clef's entropy detector looks for values appearing after `=` or `:` (assignment positions) and flags them if:

- The value is at least 20 characters long
- Shannon entropy exceeds 4.5 bits per character

These thresholds are conservative by design. Base64-encoded secrets, API keys, and random tokens typically exceed 4.5 bits/char. Lock file hashes, UUIDs, and natural language strings typically do not.

## Reducing false positives with .clefignore

`clef init` creates a `.clefignore` file in your repo root with sensible defaults. Add rules to suppress known false positives.

**Exclude directories:**

```
# Files in these directories are never scanned
vendor/
.terraform/
```

**Exclude file patterns:**

```
# Lock files contain high-entropy hashes but no secrets
*.lock
package-lock.json
yarn.lock
```

**Disable a specific pattern check globally:**

```
# Our public key files trigger "Private key header" — suppress it
ignore-pattern: Private key header
```

**Inline suppression** — add `# clef-ignore` on the same line as a known false positive:

```yaml
# config/public-keys.yaml
team_key: age1qlzqjf... # clef-ignore
```

When to use which approach:

- **Directory exclude**: test fixtures, vendored code, generated files
- **File pattern exclude**: lock files, build artifacts, binary-adjacent text files
- **Pattern disable**: when a specific detector consistently triggers on legitimate content
- **Inline**: one-off false positives in otherwise-clean files

## Using clef scan in CI

Add `clef scan` to your CI pipeline as a secrets detection gate:

```yaml
- name: Scan for unencrypted secrets
  run: clef scan --severity high
```

Use `--severity high` in CI. Entropy detection occasionally produces false positives on generated files (checksums, minified output, encoded assets). Pattern detection is high-signal. Use pattern-only as the CI gate and run full scan locally where you can interactively suppress false positives.

Pattern matches in CI fail with exit code 1, blocking the build until the secret is moved into Clef or the match is suppressed via `.clefignore`.

## The pre-commit hook

When you run `clef hooks install`, Clef installs a pre-commit hook that automatically runs `clef scan --staged` before each commit. Only staged files are scanned, so performance is fast — typically under one second for a normal commit.

If the scan finds issues, the commit is blocked with a message explaining what was found. The `--no-verify` flag bypasses the hook:

```bash
git commit --no-verify  # bypasses all hooks
```

This escape hatch is intentional. Teams sometimes need to commit test fixtures or respond to emergencies. Bypassing the hook is a deliberate choice that leaves a visible record in the reflog.

## Using the scan screen in the UI

`clef ui` includes a Scan screen that provides the same detection as `clef scan`. Navigate to **Scan** in the sidebar to run a scan and review results.

The Scan screen shows the same severity toggle (All / High) and per-match dismiss controls as the CLI. Fix commands shown in the UI are copy-paste ready for the terminal. When you navigate away and back, the last scan result is preserved — you do not need to re-run the scan.

The Scan nav item shows a badge count (⚠2) when the last scan found unresolved issues.

## What clef scan does not do

`clef scan` checks your working tree only. It does not scan git history. A secret that was committed and then removed in a later commit is still present in git history and still accessible to anyone with repo access.

For historical scanning, use dedicated tools:

- [truffleHog](https://github.com/trufflesecurity/trufflehog) — git history secret scanning
- [gitleaks](https://github.com/gitleaks/gitleaks) — git secrets detection with pre-commit support

Use `clef scan` to stay clean going forward. Use truffleHog or gitleaks to audit history when onboarding Clef into an existing repository.
