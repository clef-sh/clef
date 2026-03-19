# Scanning for Secrets

`clef scan` catches secrets that escaped the Clef matrix — values hardcoded in source files, config files, or `.env` files.

## What clef scan detects

Two categories:

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

Pattern detection targets well-known secret formats with fixed prefixes. False positives on pattern matches are rare.

## How entropy detection works

Shannon entropy measures how unpredictable characters are. `password` has low entropy; `4xK9mQ2pLv8nR3wZ` has high entropy.

Clef flags values after `=` or `:` if they are at least 20 characters long with Shannon entropy above 4.5 bits/char. Base64 secrets, API keys, and random tokens typically exceed this threshold. Lock file hashes, UUIDs, and natural language typically do not.

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

```yaml
- name: Scan for unencrypted secrets
  run: clef scan --severity high
```

Use `--severity high` in CI — entropy detection can produce false positives on generated files; pattern detection does not. Pattern matches exit with code 1, blocking the build until the secret is moved into Clef or suppressed via `.clefignore`.

## The pre-commit hook

`clef hooks install` installs a pre-commit hook that runs `clef scan --staged` before each commit (staged files only — typically under one second). The `--no-verify` flag bypasses all hooks:

```bash
git commit --no-verify
```

## Using the scan screen in the UI

Navigate to **Scan** in the sidebar for the same detection as `clef scan`. Fix commands are copy-paste ready, the last scan result is preserved between navigation, and the Scan nav item shows a badge count when unresolved issues exist.

## What clef scan does not do

`clef scan` checks the working tree only — not git history. A secret committed and later removed is still in history and accessible to anyone with repo access. For historical scanning use [truffleHog](https://github.com/trufflesecurity/trufflehog) or [gitleaks](https://github.com/gitleaks/gitleaks).
