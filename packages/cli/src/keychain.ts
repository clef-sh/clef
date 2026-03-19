import { SubprocessRunner } from "@clef-sh/core";

const SERVICE = "clef";

/**
 * C# source defining a static CredHelper class that wraps advapi32.dll's
 * CredRead / CredWrite / CredFree for generic credentials.
 *
 * Works identically in PowerShell 5.1 (powershell.exe) and PowerShell 7+ (pwsh)
 * because Add-Type compiles against a system DLL — no .NET version dependency.
 */
const CRED_HELPER_CS = `
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class CredHelper {
    private const int CRED_TYPE_GENERIC = 1;
    private const int CRED_PERSIST_LOCAL_MACHINE = 2;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public long LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CredRead(string target, int type, int flags, out IntPtr cred);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CredWrite(ref CREDENTIAL cred, int flags);

    [DllImport("advapi32.dll")]
    private static extern void CredFree(IntPtr cred);

    public static string Read(string target) {
        IntPtr credPtr;
        if (!CredRead(target, CRED_TYPE_GENERIC, 0, out credPtr)) return "";
        try {
            var cred = (CREDENTIAL)Marshal.PtrToStructure(credPtr, typeof(CREDENTIAL));
            if (cred.CredentialBlobSize <= 0) return "";
            return Marshal.PtrToStringUni(cred.CredentialBlob, cred.CredentialBlobSize / 2);
        } finally {
            CredFree(credPtr);
        }
    }

    public static bool Write(string target, string user, string secret) {
        byte[] blob = Encoding.Unicode.GetBytes(secret);
        var cred = new CREDENTIAL();
        cred.Type = CRED_TYPE_GENERIC;
        cred.TargetName = target;
        cred.UserName = user;
        cred.CredentialBlobSize = blob.Length;
        cred.Persist = CRED_PERSIST_LOCAL_MACHINE;
        cred.CredentialBlob = Marshal.AllocHGlobal(blob.Length);
        try {
            Marshal.Copy(blob, 0, cred.CredentialBlob, blob.Length);
            return CredWrite(ref cred, 0);
        } finally {
            Marshal.FreeHGlobal(cred.CredentialBlob);
        }
    }
}
`;

/**
 * Retrieve the age private key from the OS keychain.
 * Returns the AGE-SECRET-KEY-1... string, or null if unavailable or not found.
 *
 * macOS   — uses the `security` CLI (ships with macOS, always available)
 * Linux   — uses `secret-tool` (libsecret); returns null if not installed
 * Windows — uses PowerShell + advapi32.dll PInvoke (Windows Credential Manager)
 */
export async function getKeychainKey(
  runner: SubprocessRunner,
  label: string,
): Promise<string | null> {
  const account = `age-private-key:${label}`;
  switch (process.platform) {
    case "darwin":
      return getDarwin(runner, account);
    case "linux":
      return getLinux(runner, account);
    case "win32":
      return getWindows(runner, account);
    default:
      return null;
  }
}

/**
 * Store the age private key in the OS keychain.
 * Returns true on success, false if the keychain is unavailable or the write fails.
 *
 * macOS   — uses the `security` CLI
 * Linux   — uses `secret-tool` (libsecret)
 * Windows — uses PowerShell + advapi32.dll PInvoke (Windows Credential Manager)
 */
export async function setKeychainKey(
  runner: SubprocessRunner,
  privateKey: string,
  label: string,
): Promise<boolean> {
  const account = `age-private-key:${label}`;
  switch (process.platform) {
    case "darwin":
      return setDarwin(runner, privateKey, account);
    case "linux":
      return setLinux(runner, privateKey, account);
    case "win32":
      return setWindows(runner, privateKey, account);
    default:
      return false;
  }
}

// ── macOS ─────────────────────────────────────────────────────────────────────

async function getDarwin(runner: SubprocessRunner, account: string): Promise<string | null> {
  try {
    const result = await runner.run("security", [
      "find-generic-password",
      "-a",
      account,
      "-s",
      SERVICE,
      "-w",
    ]);
    if (result.exitCode === 0) {
      const key = result.stdout.trim();
      if (key.startsWith("AGE-SECRET-KEY-")) return key;
    }
    return null;
  } catch {
    return null;
  }
}

async function setDarwin(
  runner: SubprocessRunner,
  privateKey: string,
  account: string,
): Promise<boolean> {
  // Delete existing entry first — `add-generic-password` fails with "duplicate item" otherwise
  await runner
    .run("security", ["delete-generic-password", "-a", account, "-s", SERVICE])
    .catch(() => {});

  const result = await runner.run("security", [
    "add-generic-password",
    "-a",
    account,
    "-s",
    SERVICE,
    "-w",
    privateKey,
  ]);
  return result.exitCode === 0;
}

// ── Linux (libsecret / GNOME Keyring / KWallet) ───────────────────────────────

async function getLinux(runner: SubprocessRunner, account: string): Promise<string | null> {
  try {
    const result = await runner.run("secret-tool", [
      "lookup",
      "service",
      SERVICE,
      "account",
      account,
    ]);
    if (result.exitCode === 0) {
      const key = result.stdout.trim();
      if (key.startsWith("AGE-SECRET-KEY-")) return key;
    }
    return null;
  } catch {
    return null;
  }
}

async function setLinux(
  runner: SubprocessRunner,
  privateKey: string,
  account: string,
): Promise<boolean> {
  try {
    const result = await runner.run(
      "secret-tool",
      ["store", "--label", "Clef age private key", "service", SERVICE, "account", account],
      { stdin: privateKey },
    );
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

// ── Windows (advapi32 PInvoke via PowerShell) ─────────────────────────────────

/**
 * Resolve an available PowerShell shell. Prefers `pwsh` (PS7, ~200ms startup)
 * over `powershell.exe` (PS5.1, ~500ms). Returns null if neither available.
 */
async function resolveWindowsShell(runner: SubprocessRunner): Promise<string | null> {
  for (const shell of ["pwsh", "powershell.exe"]) {
    try {
      const result = await runner.run(shell, ["-NonInteractive", "-NoProfile", "-Command", "1"]);
      if (result.exitCode === 0) return shell;
    } catch {
      // not available, try next
    }
  }
  return null;
}

async function getWindows(runner: SubprocessRunner, account: string): Promise<string | null> {
  const shell = await resolveWindowsShell(runner);
  if (!shell) return null;

  const target = `${SERVICE}:${account}`;
  try {
    const command = [
      `Add-Type -TypeDefinition @'\n${CRED_HELPER_CS}\n'@ -Language CSharp;`,
      `[CredHelper]::Read('${target}')`,
    ].join(" ");

    const result = await runner.run(shell, ["-NonInteractive", "-NoProfile", "-Command", command]);
    if (result.exitCode === 0) {
      const key = result.stdout.trim();
      if (key.startsWith("AGE-SECRET-KEY-")) return key;
    }
    return null;
  } catch {
    return null;
  }
}

async function setWindows(
  runner: SubprocessRunner,
  privateKey: string,
  account: string,
): Promise<boolean> {
  const shell = await resolveWindowsShell(runner);
  if (!shell) return false;

  const target = `${SERVICE}:${account}`;
  try {
    const command = [
      "$key = [Console]::In.ReadLine();",
      `Add-Type -TypeDefinition @'\n${CRED_HELPER_CS}\n'@ -Language CSharp;`,
      `if ([CredHelper]::Write('${target}', '${account}', $key)) { exit 0 } else { exit 1 }`,
    ].join(" ");

    const result = await runner.run(shell, ["-NonInteractive", "-NoProfile", "-Command", command], {
      stdin: privateKey,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
