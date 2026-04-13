# clef cloud

Manage Clef Cloud integration. These commands connect your repository to Clef Cloud for managed KMS and bot-powered PR automation.

::: info Optional package
`clef cloud` requires `@clef-sh/cloud`. Enable it with the `CLEF_CLOUD=1` environment variable once installed.
:::

## Synopsis

```bash
clef cloud <subcommand> [flags]
```

## Subcommands

| Subcommand              | Description                                                |
| ----------------------- | ---------------------------------------------------------- |
| `clef cloud init`       | Sign up, install the Clef bot, scaffold `.clef/policy.yaml` |
| `clef cloud login`      | Authenticate to Clef Cloud                                 |
| `clef cloud logout`     | Clear local Clef Cloud credentials                         |
| `clef cloud status`     | Show account, installation, and subscription status        |
| `clef cloud doctor`     | Verify Cloud setup: policy file, credentials, git remote   |
| `clef cloud upgrade`    | Upgrade to a paid Clef Cloud plan                          |

---

## clef cloud init

Sign up for Clef Cloud, install the Clef bot on your repository, and scaffold `.clef/policy.yaml` with sensible defaults.

```bash
clef cloud init [flags]
```

### What it does

1. Authenticates you via your VCS provider (GitHub OAuth device flow)
2. Installs the Clef GitHub App on your repository
3. Creates `.clef/policy.yaml` if one doesn't already exist

### Flags

| Flag                    | Type   | Default    | Description                                         |
| ----------------------- | ------ | ---------- | --------------------------------------------------- |
| `--provider <name>`     | string | `github`   | VCS provider to authenticate with                   |
| `--repo <owner/name>`   | string | auto-detect | Override repo detection from git remote             |
| `--no-browser`          | bool   | false      | Print URLs instead of opening a browser             |
| `--non-interactive`     | bool   | false      | Fail if any interactive prompt is required          |
| `--policy-file <path>`  | string | `.clef/policy.yaml` | Custom policy file path                  |
| `--no-policy`           | bool   | false      | Skip policy file creation                           |

### After init

```bash
git add .clef/policy.yaml
git commit -m "Enable Clef bot"
git push
```

The bot runs automatically on your next pull request.

---

## clef cloud login

Authenticate to Clef Cloud using the GitHub OAuth device flow.

```bash
clef cloud login [--provider <name>]
```

Opens a browser to complete authentication. If you are already logged in with a valid session, the command exits immediately.

---

## clef cloud logout

Clear locally stored Clef Cloud credentials.

```bash
clef cloud logout
```

---

## clef cloud status

Show your current Clef Cloud account, bot installation, and subscription tier.

```bash
clef cloud status
```

Example output:

```
  Clef Cloud Status

  Signed in as: acmecorp (acme@example.com)
  Bot installed: acmecorp (id: 12345678)
  Plan: free
```

---

## clef cloud doctor

Check that your Clef Cloud setup is complete and healthy.

```bash
clef cloud doctor
```

Checks:

- `clef.yaml` exists in the repository root
- `.clef/policy.yaml` is present and valid
- Local session credentials are valid (not expired)
- Git remote is detectable

Example output:

```
  Clef Cloud Doctor

  ✔ clef.yaml found
  ✔ .clef/policy.yaml valid
  ✔ Session valid (acmecorp)
  ✔ Git remote: acmecorp/myrepo

  Everything looks good!
```

---

## clef cloud upgrade

Upgrade to a paid Clef Cloud plan.

```bash
clef cloud upgrade
```

---

## Related commands

- [`clef init`](init.md) — initialize a repository with `clef.yaml`
- [`clef serve`](serve.md) — local dev secrets server (mirrors production Cloud serve)
- [`clef pack`](pack.md) — pack a service artifact for deployment
- [`clef service`](service.md) — manage service identities
