import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";
import * as YAML from "yaml";
import type { AgeKeyPair } from "./keys";

export interface TestRepo {
  dir: string;
  cleanup: () => void;
}

/**
 * Scaffold a minimal Clef test repo with a manifest and encrypted files.
 * Mirrors the integration test scaffold so the SEA binary has a real repo to serve.
 */
export function scaffoldTestRepo(keys: AgeKeyPair, serviceIdentityKeys?: AgeKeyPair): TestRepo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-e2e-repo-"));

  // Generate service identity key pair if not provided
  let siKeys = serviceIdentityKeys;
  if (!siKeys) {
    const helperPath = path.resolve(__dirname, "age-keygen-helper.mjs");
    const siDevResult = JSON.parse(
      execFileSync(process.execPath, [helperPath], { encoding: "utf-8" }),
    ) as { privateKey: string; publicKey: string };
    const siTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-e2e-si-"));
    siKeys = {
      publicKey: siDevResult.publicKey,
      privateKey: siDevResult.privateKey,
      keyFilePath: path.join(siTmpDir, "si-key.txt"),
      tmpDir: siTmpDir,
    };
  }

  const manifest = {
    version: 1,
    environments: [
      { name: "dev", description: "Development" },
      { name: "production", description: "Production", protected: true },
    ],
    namespaces: [{ name: "payments", description: "Payment secrets" }],
    sops: {
      default_backend: "age",
      age: { recipients: [keys.publicKey] },
    },
    file_pattern: "{namespace}/{environment}.enc.yaml",
    service_identities: [
      {
        name: "web-app",
        description: "Web application service",
        namespaces: ["payments"],
        environments: {
          dev: { recipient: siKeys.publicKey },
          production: { recipient: siKeys.publicKey },
        },
      },
    ],
  };

  fs.writeFileSync(path.join(dir, "clef.yaml"), YAML.stringify(manifest));

  fs.mkdirSync(path.join(dir, "payments"), { recursive: true });

  const encryptFile = (values: Record<string, string>, filename: string): void => {
    const plaintext = YAML.stringify(values);
    const plaintextFile = path.join(dir, "payments", `${filename}.plain.yaml`);
    fs.writeFileSync(plaintextFile, plaintext);

    const encrypted = execFileSync(
      "sops",
      [
        "--config",
        process.platform === "win32" ? "NUL" : "/dev/null",
        "encrypt",
        "--age",
        keys.publicKey,
        "--input-type",
        "yaml",
        "--output-type",
        "yaml",
        "--filename-override",
        `payments/${filename}.enc.yaml`,
        plaintextFile,
      ],
      {
        cwd: dir,
        env: { ...process.env, SOPS_AGE_KEY_FILE: keys.keyFilePath },
      },
    );

    fs.unlinkSync(plaintextFile);
    fs.writeFileSync(path.join(dir, "payments", `${filename}.enc.yaml`), encrypted);
  };

  encryptFile({ STRIPE_KEY: "sk_test_abc123", STRIPE_WEBHOOK_SECRET: "whsec_xyz789" }, "dev");
  encryptFile(
    { STRIPE_KEY: "sk_live_prod456", STRIPE_WEBHOOK_SECRET: "whsec_prod_abc" },
    "production",
  );

  // Init a git repo so the UI's git-status and git-log endpoints don't error.
  // Set user.name/user.email on the repo itself so TransactionManager's
  // preflight author-identity check finds them in CI (where there is no
  // global git config). Locally this is a no-op since the developer's global
  // config already provides these.
  execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["add", "."], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: dir, stdio: "pipe" });

  return {
    dir,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    },
  };
}

/**
 * Write `.clef/policy.yaml` with the given policy document.  Creates the
 * `.clef/` directory if missing.  Used by policy-ui e2e tests to switch
 * between `source: "default"` and `source: "file"` without restarting the
 * server — /api/policy and /api/policy/check compute on each request.
 */
export function writePolicyFile(repoDir: string, policy: Record<string, unknown>): void {
  const policyDir = path.join(repoDir, ".clef");
  fs.mkdirSync(policyDir, { recursive: true });
  fs.writeFileSync(path.join(policyDir, "policy.yaml"), YAML.stringify(policy));
}

/**
 * Delete `.clef/policy.yaml` if present.  No-op when the file is absent.
 */
export function removePolicyFile(repoDir: string): void {
  const file = path.join(repoDir, ".clef", "policy.yaml");
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/**
 * Remove the `sops.lastmodified` key from an encrypted file's SOPS metadata
 * block.  SOPS stores this timestamp in plaintext alongside the encrypted
 * values, so we can mutate it without decrypting.  The result drives
 * `last_modified_known: false` in the policy verdict — the "Unknown" bucket
 * in the Policy screen.
 *
 * sops will treat the file as still encrypted; this is a surgical edit of a
 * single metadata field, not a re-encryption.
 */
export function stripSopsLastmodified(filePath: string): void {
  const raw = fs.readFileSync(filePath, "utf-8");
  const doc = YAML.parse(raw) as Record<string, unknown>;
  const sops = doc.sops as Record<string, unknown> | undefined;
  if (!sops) throw new Error(`${filePath} is not a SOPS-encrypted file (no sops: block)`);
  delete sops.lastmodified;
  fs.writeFileSync(filePath, YAML.stringify(doc));
}
