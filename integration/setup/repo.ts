import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";
import * as YAML from "yaml";
import { AgeKeyPair } from "./keys";

export interface TestRepo {
  dir: string;
  cleanup: () => void;
  /**
   * When `includeServiceIdentity: true`, this is the service identity's
   * runtime private key (AGE-SECRET-KEY-…). The matching public key is
   * wired into the manifest automatically. Tests that need to decrypt a
   * packed artifact (e.g. the envelope roundtrip) read this; tests that
   * synthesize their own key (e.g. serve-roundtrip) ignore it.
   */
  serviceIdentityPrivateKey?: string;
  /** Path to a file containing `serviceIdentityPrivateKey` — convenient for --identity flags. */
  serviceIdentityKeyFilePath?: string;
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

  // Generate a fresh age keypair for the service identity. `clef serve`
  // synthesizes its own ephemeral key and overwrites the recipient anyway,
  // but tests that decrypt a `clef pack` output (e.g. envelope roundtrip)
  // need the matching private key. We return both halves on TestRepo.
  // The key file lives outside the repo so it is never git-committed.
  let siRecipient: string | undefined;
  let siPrivateKey: string | undefined;
  let siKeyFilePath: string | undefined;
  if (options?.includeServiceIdentity) {
    const helperPath = path.resolve(__dirname, "age-keygen-helper.mjs");
    const result = execFileSync(process.execPath, [helperPath], { encoding: "utf-8" });
    const parsed = JSON.parse(result) as { publicKey: string; privateKey: string };
    siRecipient = parsed.publicKey;
    siPrivateKey = parsed.privateKey;
    const siKeyDir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-si-"));
    siKeyFilePath = path.join(siKeyDir, "key.txt");
    fs.writeFileSync(
      siKeyFilePath,
      `# created: ${new Date().toISOString()}\n# public key: ${parsed.publicKey}\n${parsed.privateKey}\n`,
      { mode: 0o600 },
    );
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

  // Seed `.clef-meta.yaml` sidecars with fresh rotation records for every
  // key we just encrypted.  Without these, per-key policy treats the keys
  // as "unknown rotation state" (correct by design — the real sops CLI
  // doesn't write clef metadata), which would fail the default-healthy
  // expectations of any test that assumes a fresh scaffold is compliant.
  const writeMeta = (filename: string, keyNames: string[]): void => {
    const metaContent = [
      "# Managed by Clef. Do not edit manually.",
      "version: 1",
      "pending: []",
      "rotations:",
      ...keyNames.flatMap((k) => [
        `  - key: ${k}`,
        `    last_rotated_at: "${new Date().toISOString()}"`,
        `    rotated_by: "scaffold"`,
        `    rotation_count: 1`,
      ]),
      "",
    ].join("\n");
    fs.writeFileSync(path.join(dir, "payments", `${filename}.clef-meta.yaml`), metaContent);
  };
  writeMeta("dev", ["STRIPE_KEY", "STRIPE_WEBHOOK_SECRET"]);
  writeMeta("production", ["STRIPE_KEY", "STRIPE_WEBHOOK_SECRET"]);

  // Init git repo for git operations. Set user.name/user.email on the repo
  // itself so TransactionManager's preflight author-identity check finds
  // them in CI (where there is no global git config). Locally this is a
  // no-op since the developer's global config already provides these.
  execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["add", "."], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "initial"], {
    cwd: dir,
    stdio: "pipe",
  });

  const siKeyDir = siKeyFilePath ? path.dirname(siKeyFilePath) : undefined;
  return {
    dir,
    serviceIdentityPrivateKey: siPrivateKey,
    serviceIdentityKeyFilePath: siKeyFilePath,
    cleanup: () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
      if (siKeyDir) {
        try {
          fs.rmSync(siKeyDir, { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    },
  };
}
