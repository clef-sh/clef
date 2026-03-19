# Key Storage

Clef stores your age private key using the most secure method available. The OS keychain is preferred; filesystem is a last resort requiring explicit confirmation.

## Per-repo labeled keys

Each `clef init` generates a unique **label** (e.g. `coral-tiger`) stored in `.clef/config.yaml`. The label namespaces the key in the OS keychain and filesystem, so compromising one repo's key does not expose others.

## Storage priority

When `clef init` generates a new age key pair, it attempts to store the private key in this order:

1. **OS keychain** (preferred) -- the key is stored in your operating system's credential manager under a labeled account (e.g. `age-private-key:coral-tiger`) and never written to disk as plaintext
2. **Filesystem** (fallback) -- the key is written to a labeled path outside any git repository (e.g. `~/.config/clef/keys/coral-tiger/keys.txt`) with restrictive permissions (`0600`), only after you confirm

If the keychain is unavailable, Clef warns you and asks for explicit acknowledgment before writing to disk.

## OS keychain storage

| Platform | Backend                               | Where it appears                                         |
| -------- | ------------------------------------- | -------------------------------------------------------- |
| macOS    | Keychain Services (`security` CLI)    | Keychain Access, login keychain                          |
| Linux    | libsecret (`secret-tool`)             | GNOME Keyring or KWallet                                 |
| Windows  | Credential Manager (advapi32 PInvoke) | Control Panel > Credential Manager > Generic Credentials |

**Advantages:** key is encrypted at rest by the OS, never written as plaintext, tied to your user session, retrieved into memory only when needed, and namespaced per repo.

**When keychain is unavailable:** Linux without `secret-tool`, headless servers, CI/CD environments. Use `CLEF_AGE_KEY` in CI — see [CI/CD Integration](/guide/ci-cd).

## Filesystem storage

**Default location:** `~/.config/clef/keys/{label}/keys.txt` — each repo gets its own directory. You must explicitly confirm before the file is written.

### Protections in place

- File permissions are set to `0600` (owner read/write only)
- Clef verifies the path is outside any git repository before writing
- The path is stored in `.clef/config.yaml` (gitignored via `.clef/.gitignore`)

### Risks to understand

- The key is plaintext on disk, readable by any process running as your user
- Disk forensics, backups, or snapshots may capture the key
- Network-mounted home directories (NFS, SMB) expose the key over the wire

Full-disk encryption mitigates at-rest risk but does not prevent access by processes running under your user account.

### Recommendations if using filesystem storage

- Ensure your disk is encrypted (FileVault on macOS, BitLocker on Windows, LUKS on Linux)
- Avoid network-mounted home directories for the key path
- Regularly audit file access if your threat model requires it
- Consider installing the OS keychain backend for your platform to upgrade later:
  - **Linux:** `sudo apt install libsecret-tools` (Debian/Ubuntu) or `sudo dnf install libsecret` (Fedora)
  - **Windows:** PowerShell is typically available by default

## Environment variables

For CI/CD and automation, these variables bypass keychain and filesystem:

| Variable            | Description                                                    |
| ------------------- | -------------------------------------------------------------- |
| `CLEF_AGE_KEY`      | The full private key string, injected into the SOPS subprocess |
| `CLEF_AGE_KEY_FILE` | Path to a key file, injected into the SOPS subprocess          |

These take precedence over `.clef/config.yaml` but not the OS keychain. See [CI/CD Integration](/guide/ci-cd).

::: info Why CLEF*AGE_KEY instead of SOPS_AGE_KEY?
Clef uses its own `CLEF*\*`namespace to prevent silent, unexpected credential leakage. If Clef read`SOPS_AGE_KEY`directly, existing SOPS users could have their key silently reused by Clef — or vice versa — with no signal that cross-tool sharing is happening. By using`CLEF_AGE_KEY`, the intent is explicit: you opt in to providing Clef with a key, and Clef passes it to the SOPS subprocess directly without mutating the parent process environment.
:::

## Credential resolution order

When Clef needs the private key (for decrypt, set, rotate, etc.), it checks sources in this order:

1. OS keychain (using the label from `.clef/config.yaml`)
2. `CLEF_AGE_KEY` environment variable
3. `CLEF_AGE_KEY_FILE` environment variable
4. `.clef/config.yaml` `age_key_file` path

The first source that returns a valid `AGE-SECRET-KEY-` value wins.

## Blast radius containment

Each repo has its own key and label. Keys are independently rotatable, and compromising one repo does not expose others.

## See also

- [age backend](/backends/age) -- key generation, recipients, and SOPS configuration
- [CI/CD Integration](/guide/ci-cd) -- managing keys in automated environments
- [Team Setup](/guide/team-setup) -- multi-developer key management
