import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";
import * as YAML from "yaml";
import { AgeKeyPair } from "./keys";

export interface TestRepo {
  dir: string;
  cleanup: () => void;
}

export interface ScaffoldOptions {
  /** Include a service identity in the manifest (for serve/pack tests). */
  includeServiceIdentity?: boolean;
}

/**
 * Scaffold a minimal Clef test repo with a manifest and an encrypted file.
 */
export function scaffoldTestRepo(keys: AgeKeyPair, options?: ScaffoldOptions): TestRepo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-repo-"));

  // Generate a throwaway public key for the service identity. The serve
  // command synthesizes its own ephemeral key and overwrites this anyway —
  // it just needs to be a valid age recipient string in the manifest.
  let siRecipient: string | undefined;
  if (options?.includeServiceIdentity) {
    const helperPath = path.resolve(__dirname, "age-keygen-helper.mjs");
    const result = execFileSync(process.execPath, [helperPath], { encoding: "utf-8" });
    siRecipient = (JSON.parse(result) as { publicKey: string }).publicKey;
  }

  const manifest: Record<string, unknown> = {
    version: 1,
    environments: [
      { name: "dev", description: "Development" },
      { name: "production", description: "Production", protected: true },
    ],
    namespaces: [{ name: "payments", description: "Payment secrets" }],
    sops: { default_backend: "age", age: { recipients: [keys.publicKey] } },
    file_pattern: "{namespace}/{environment}.enc.yaml",
  };

  if (siRecipient) {
    manifest.service_identities = [
      {
        name: "web-app",
        description: "Web application service identity",
        namespaces: ["payments"],
        environments: {
          dev: { recipient: siRecipient },
          production: { recipient: siRecipient },
        },
      },
    ];
  }

  // Write manifest
  fs.writeFileSync(path.join(dir, "clef.yaml"), YAML.stringify(manifest));

  // Create namespace directory
  fs.mkdirSync(path.join(dir, "payments"), { recursive: true });

  // Create and encrypt a file with known values
  const plaintext = YAML.stringify({
    STRIPE_KEY: "sk_test_abc123",
    STRIPE_WEBHOOK_SECRET: "whsec_xyz789",
  });

  const plaintextFile = path.join(dir, "payments", "dev.plain.yaml");
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
      "payments/dev.enc.yaml",
      plaintextFile,
    ],
    {
      cwd: dir,
      env: {
        ...process.env,
        SOPS_AGE_KEY_FILE: keys.keyFilePath,
      },
    },
  );

  fs.unlinkSync(plaintextFile);
  fs.writeFileSync(path.join(dir, "payments", "dev.enc.yaml"), encrypted);

  // Also create production file
  const prodPlaintext = YAML.stringify({
    STRIPE_KEY: "sk_live_prod456",
    STRIPE_WEBHOOK_SECRET: "whsec_prod_abc",
  });

  const prodPlaintextFile = path.join(dir, "payments", "production.plain.yaml");
  fs.writeFileSync(prodPlaintextFile, prodPlaintext);

  const prodEncrypted = execFileSync(
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
      "payments/production.enc.yaml",
      prodPlaintextFile,
    ],
    {
      cwd: dir,
      env: {
        ...process.env,
        SOPS_AGE_KEY_FILE: keys.keyFilePath,
      },
    },
  );

  fs.unlinkSync(prodPlaintextFile);
  fs.writeFileSync(path.join(dir, "payments", "production.enc.yaml"), prodEncrypted);

  // Init git repo for git operations
  execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["add", "."], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "initial"], {
    cwd: dir,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@test.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@test.com",
    },
  });

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
