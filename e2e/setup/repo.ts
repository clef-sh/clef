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
export function scaffoldTestRepo(keys: AgeKeyPair): TestRepo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clef-e2e-repo-"));

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
  };

  fs.writeFileSync(path.join(dir, "clef.yaml"), YAML.stringify(manifest));

  const sopsConfig = {
    creation_rules: [
      {
        path_regex: ".*\\.enc\\.yaml$",
        age: keys.publicKey,
      },
    ],
  };
  fs.writeFileSync(path.join(dir, ".sops.yaml"), YAML.stringify(sopsConfig));

  fs.mkdirSync(path.join(dir, "payments"), { recursive: true });

  const encryptFile = (values: Record<string, string>, filename: string): void => {
    const plaintext = YAML.stringify(values);
    const plaintextFile = path.join(dir, "payments", `${filename}.plain.yaml`);
    fs.writeFileSync(plaintextFile, plaintext);

    const encrypted = execFileSync(
      "sops",
      [
        "encrypt",
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
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@test.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@test.com",
  };
  execFileSync("git", ["init"], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["add", "."], { cwd: dir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: dir, stdio: "pipe", env: gitEnv });

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
