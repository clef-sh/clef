# test-windows-keychain.ps1
# Manual validation script for Windows Credential Manager integration.
# Run on a real Windows machine: pwsh ./test-windows-keychain.ps1
# Uses a test target name so it doesn't interfere with real credentials.

$ErrorActionPreference = "Stop"
$TestTarget = "clef-test:validation"
$TestUser = "test-user"
$TestSecret = "AGE-SECRET-KEY-1QFNJ04MG0GY93XAGNHXQ4RCSSMNDCZPLGUXK9TLMD0Z4MRAWEQSZ9J7NF"

$CSharpSource = @'
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

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CredDelete(string target, int type, int flags);

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

    public static bool Delete(string target) {
        return CredDelete(target, CRED_TYPE_GENERIC, 0);
    }
}
'@

Add-Type -TypeDefinition $CSharpSource -Language CSharp

$passed = 0
$failed = 0

function Assert-True($condition, $message) {
    if ($condition) {
        Write-Host "  PASS: $message" -ForegroundColor Green
        $script:passed++
    } else {
        Write-Host "  FAIL: $message" -ForegroundColor Red
        $script:failed++
    }
}

Write-Host "`nWindows Credential Manager - keychain integration tests`n" -ForegroundColor Cyan

# Cleanup from prior runs
[CredHelper]::Delete($TestTarget) | Out-Null

# Test 1: Read missing credential
Write-Host "Test 1: Read non-existent credential"
$result = [CredHelper]::Read($TestTarget)
Assert-True ($result -eq "") "Read returns empty string for missing credential"

# Test 2: Write credential
Write-Host "Test 2: Write credential"
$ok = [CredHelper]::Write($TestTarget, $TestUser, $TestSecret)
Assert-True $ok "Write returns true"

# Test 3: Read back credential
Write-Host "Test 3: Read back credential"
$result = [CredHelper]::Read($TestTarget)
Assert-True ($result -eq $TestSecret) "Read returns the written secret"

# Test 4: Overwrite credential
Write-Host "Test 4: Overwrite credential (CredWrite with same target)"
$newSecret = "AGE-SECRET-KEY-OVERWRITTEN000000000000000000000000000000000000000"
$ok = [CredHelper]::Write($TestTarget, $TestUser, $newSecret)
Assert-True $ok "Overwrite returns true"
$result = [CredHelper]::Read($TestTarget)
Assert-True ($result -eq $newSecret) "Read returns the overwritten secret"

# Cleanup
Write-Host "`nCleanup"
$ok = [CredHelper]::Delete($TestTarget)
Assert-True $ok "Delete returns true"
$result = [CredHelper]::Read($TestTarget)
Assert-True ($result -eq "") "Read returns empty after delete"

# Summary
Write-Host "`n---"
Write-Host "Passed: $passed  Failed: $failed" -ForegroundColor $(if ($failed -eq 0) { "Green" } else { "Red" })
if ($failed -gt 0) { exit 1 }
