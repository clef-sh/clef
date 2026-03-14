# clef doctor

Check your environment for required dependencies and configuration. This is the first command to run when something is not working — it verifies that all external binaries are installed, meets version requirements, and that your Clef repository is correctly configured.

## Syntax

```bash
clef doctor [options]
```

## Flags

| Flag     | Type    | Default | Description                                                                                  |
| -------- | ------- | ------- | -------------------------------------------------------------------------------------------- |
| `--json` | boolean | `false` | Output the full status as JSON for scripting.                                                |
| `--fix`  | boolean | `false` | Attempt to auto-fix issues (generates `.sops.yaml` from manifest if it is the only failure). |

## Exit Codes

| Code | Meaning                   |
| ---- | ------------------------- |
| `0`  | All checks pass           |
| `1`  | One or more checks failed |

## Checks

`clef doctor` runs the following checks in order:

| Check            | What it verifies                                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **clef**         | Prints the current Clef version                                                                                                                                         |
| **sops**         | SOPS binary is installed and meets the minimum version requirement (>= 3.8.0)                                                                                           |
| **git**          | git binary is installed and meets the minimum version requirement (>= 2.28.0)                                                                                           |
| **manifest**     | `clef.yaml` exists in the current directory (or `--dir` directory)                                                                                                      |
| **age key**      | Only checked when the manifest uses the age backend. An age key is available via `CLEF_AGE_KEY` env var, `CLEF_AGE_KEY_FILE`, or the path stored in `.clef/config.yaml` |
| **.sops.yaml**   | `.sops.yaml` exists (required for SOPS creation rules)                                                                                                                  |
| **scanner**      | `.clefignore` exists in the repository root (used by `clef scan` to exclude paths from secret scanning)                                                                 |
| **merge driver** | SOPS merge driver is configured in `.git/config` and `.gitattributes` (see [Merge Conflicts](/guide/merge-conflicts))                                                   |

## Output Format

Each check prints a status line with a check mark or cross:

```
Clef environment check

✓ clef          v0.1.0
✓ sops          v3.9.4    (required >= 3.8.0)
✓ git           v2.43.0   (required >= 2.28.0)
✓ manifest      clef.yaml found
✓ age key       loaded (from OS keychain, label: coral-tiger)
✓ .sops.yaml    found
✓ scanner       .clefignore found (3 rules)
✓ merge driver  SOPS merge driver configured

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
  "git": { "version": "2.43.0", "required": "2.28.0", "ok": true },
  "manifest": { "found": true, "ok": true },
  "ageKey": { "source": "file", "recipients": 2, "ok": true },
  "sopsYaml": { "found": true, "ok": true },
  "scanner": { "clefignoreFound": true, "ok": true }
}
```

### Check a different repository

```bash
clef --dir ../other-project doctor
```

## Related Commands

- [`clef init`](/cli/init) — Initialise a new Clef repository
- [Installation](/guide/installation) — Install Clef and its dependencies
