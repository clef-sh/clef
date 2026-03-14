# Key Storage

Clef stores your age private key using the most secure method available on your system. The OS keychain is always preferred. Filesystem storage is a last resort that requires explicit confirmation.

## Per-repo labeled keys

Each `clef init` generates a unique **label** (e.g. `coral-tiger`) for the repo's age key. This label is stored in `.clef/config.yaml` as `age_keychain_label` and is used to namespace the key in both the OS keychain and the filesystem. This ensures that compromising one repo's key does not expose other repos' secrets.

## Storage priority

When `clef init` generates a new age key pair, it attempts to store the private key in this order:

1. **OS keychain** (preferred) -- the key is stored in your operating system's credential manager under a labeled account (e.g. `age-private-key:coral-tiger`) and never written to disk as plaintext
2. **Filesystem** (fallback) -- the key is written to a labeled path outside any git repository (e.g. `~/.config/clef/keys/coral-tiger/keys.txt`) with restrictive permissions (`0600`), only after you confirm

If the OS keychain is unavailable, Clef warns you and asks for explicit acknowledgment before writing the key to disk.

## OS keychain storage

| Platform | Backend                               | Where it appears                                         |
| -------- | ------------------------------------- | -------------------------------------------------------- |
| macOS    | Keychain Services (`security` CLI)    | Keychain Access, login keychain                          |
| Linux    | libsecret (`secret-tool`)             | GNOME Keyring or KWallet                                 |
| Windows  | Credential Manager (advapi32 PInvoke) | Control Panel > Credential Manager > Generic Credentials |

**Advantages:**

- Private key is encrypted at rest by the OS (DPAPI on Windows, Keychain encryption on macOS, kernel keyring on Linux)
- Key is never written to disk as plaintext
- Access is tied to your user session -- other users on the same machine cannot read it
- Key is retrieved into memory only when needed
- Each repo uses a unique labeled entry, preventing cross-repo key reuse

**When keychain is unavailable:**

- Linux without `secret-tool` installed (no GNOME Keyring / KWallet)
- Headless Linux servers without a desktop environment
- Windows without PowerShell
- CI/CD environments (use `SOPS_AGE_KEY` environment variable instead -- see [CI/CD Integration](/guide/ci-cd))

## Filesystem storage

When the OS keychain is not available, Clef falls back to storing the private key as a file. You will see a warning and a link to this page. In interactive mode, you must explicitly confirm before the file is written.

**Default location:** `~/.config/clef/keys/{label}/keys.txt`

Each repo gets its own labeled directory, ensuring key isolation across projects.

### Protections in place

- File permissions are set to `0600` (owner read/write only)
- Clef verifies the path is outside any git repository before writing
- The path is stored in `.clef/config.yaml` (gitignored via `.clef/.gitignore`)

### Risks to understand

- The private key exists as plaintext on disk, protected only by filesystem permissions
- Any process running as your user can read the file
- Disk forensics, backups, or snapshots may capture the key
- If your home directory is on a network filesystem (NFS, SMB), the key traverses the network

Full-disk encryption (FileVault, BitLocker, LUKS) mitigates the at-rest risk but does not prevent access by processes running under your user account.

### Recommendations if using filesystem storage

- Ensure your disk is encrypted (FileVault on macOS, BitLocker on Windows, LUKS on Linux)
- Avoid network-mounted home directories for the key path
- Regularly audit file access if your threat model requires it
- Consider installing the OS keychain backend for your platform to upgrade later:
  - **Linux:** `sudo apt install libsecret-tools` (Debian/Ubuntu) or `sudo dnf install libsecret` (Fedora)
  - **Windows:** PowerShell is typically available by default

## Environment variables

For CI/CD and automation, Clef supports environment variables that bypass both keychain and filesystem:

| Variable            | Description                                          |
| ------------------- | ---------------------------------------------------- |
| `SOPS_AGE_KEY`      | The full private key string, passed directly to SOPS |
| `SOPS_AGE_KEY_FILE` | Path to a key file, passed to SOPS                   |

These take precedence over `.clef/config.yaml` but not over the OS keychain. See [CI/CD Integration](/guide/ci-cd) for details.

## Credential resolution order

When Clef needs the private key (for decrypt, set, rotate, etc.), it checks sources in this order:

1. OS keychain (using the label from `.clef/config.yaml`)
2. `SOPS_AGE_KEY` environment variable
3. `SOPS_AGE_KEY_FILE` environment variable
4. `.clef/config.yaml` `age_key_file` path

The first source that returns a valid `AGE-SECRET-KEY-` value wins.

## Blast radius containment

Each repo generates its own key and label during `clef init`. This means:

- Compromising one repo's key does not expose secrets from other repos
- Keys are independently rotatable per repo
- The label provides a human-readable identifier for key management

## See also

- [age backend](/backends/age) -- key generation, recipients, and SOPS configuration
- [CI/CD Integration](/guide/ci-cd) -- managing keys in automated environments
- [Team Setup](/guide/team-setup) -- multi-developer key management
