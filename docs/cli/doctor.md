# clef doctor

Check your environment for required dependencies and configuration. This is the first command to run when something is not working — it verifies that all external binaries are installed, meets version requirements, and that your Clef repository is correctly configured.

## Syntax

```bash
clef doctor [options]
```

## Flags

| Flag     | Type    | Default | Description                                   |
| -------- | ------- | ------- | --------------------------------------------- |
| `--json` | boolean | `false` | Output the full status as JSON for scripting. |

## Exit Codes

| Code | Meaning                   |
| ---- | ------------------------- |
| `0`  | All checks pass           |
| `1`  | One or more checks failed |

## Checks

`clef doctor` runs the following checks in order:

| Check          | What it verifies                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| **clef**       | Prints the current Clef version                                                                           |
| **sops**       | SOPS binary is installed and meets the minimum version requirement (>= 3.8.0)                             |
| **age**        | age binary is installed and meets the minimum version requirement (>= 1.1.0)                              |
| **git**        | git binary is installed and meets the minimum version requirement (>= 2.28.0)                             |
| **manifest**   | `clef.yaml` exists in the current directory (or `--repo` directory)                                       |
| **age key**    | An age key is available via `SOPS_AGE_KEY` env var, `SOPS_AGE_KEY_FILE`, or the manifest's `age_key_file` |
| **.sops.yaml** | `.sops.yaml` exists (required for SOPS creation rules)                                                    |

## Output Format

Each check prints a status line with a check mark or cross:

```
Clef environment check

✓ clef          v0.1.0
✓ sops          v3.9.4    (required >= 3.8.0)
✓ age           v1.1.1    (required >= 1.1.0)
✓ git           v2.43.0   (required >= 2.28.0)
✓ manifest      clef.yaml found
✓ age key       loaded (from .sops/keys.txt)
✓ .sops.yaml    found

✓ Everything looks good.
```

When a check fails, the output includes an actionable hint:

```
✗ sops          not installed
                brew install sops
```

## Examples

### Quick environment check

```bash
clef doctor
```

### JSON output for CI scripts

```bash
clef doctor --json
```

Returns a JSON object with all check results:

```json
{
  "clef": { "version": "0.1.0", "ok": true },
  "sops": { "version": "3.9.4", "required": "3.8.0", "ok": true },
  "age": { "version": "1.1.1", "required": "1.1.0", "ok": true },
  "git": { "version": "2.43.0", "required": "2.28.0", "ok": true },
  "manifest": { "found": true, "ok": true },
  "ageKey": { "source": "env", "recipients": 0, "ok": true },
  "sopsYaml": { "found": true, "ok": true }
}
```

### Check a different repository

```bash
clef --repo ../acme-secrets doctor
```

## Related Commands

- [`clef init`](/cli/init) — Initialise a new Clef repository
- [Installation](/guide/installation) — Install Clef and its dependencies
