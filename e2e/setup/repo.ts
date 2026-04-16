import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFileSync } from "child_process";
import * as YAML from "yaml";
import type { AgeKeyPair } from "./keys";

export interface TestRepo {
  dir: string;
  /**
   * SHA of the initial commit produced by {@link scaffoldTestRepo}.  Tests
   * that mutate the repo (file edits, injected commits from helpers like
   * {@link removeRotationRecord}) can `git reset --hard` to this SHA in a
   * `beforeEach` to get a deterministic clean-tree starting point for the
   * next test without rescaffolding from scratch.
   */
  initialSha: string;
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

  // Seed `.clef-meta.yaml` sidecars with fresh rotation records for every
  // key we just encrypted.  Without these, per-key policy treats the keys
  // as "unknown rotation state" (correct by design — the real sops CLI
  // doesn't write clef metadata), which would fail the default-healthy
  // expectations of every test that assumes a fresh scaffold is compliant.
  // Tests that want to exercise the unknown/overdue paths mutate the
  // metadata files directly via helpers exported below.
  const writeMeta = (filename: string, keys: string[]): void => {
    const metaContent = [
      "# Managed by Clef. Do not edit manually.",
      "version: 1",
      "pending: []",
      "rotations:",
      ...keys.flatMap((k) => [
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
  const initialSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();

  return {
    dir,
    initialSha,
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
 * Restore a test repo to its initial scaffolded state.  Wipes any
 * test-introduced commits, working-tree changes, and untracked files.
 * Intended for use in `beforeEach` when tests share a scaffolded repo
 * but mutate different pieces of it.
 */
export function resetTestRepo(repo: TestRepo): void {
  execFileSync("git", ["reset", "--hard", repo.initialSha], {
    cwd: repo.dir,
    stdio: "pipe",
  });
  execFileSync("git", ["clean", "-fd"], { cwd: repo.dir, stdio: "pipe" });
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
 * block.  Retained for tests that need to exercise the raw-metadata path.
 * Since per-key rotation tracking replaced file-level policy, this no
 * longer drives a policy verdict on its own — use {@link removeRotationRecord}
 * for "unknown" scenarios.
 */
export function stripSopsLastmodified(filePath: string): void {
  const raw = fs.readFileSync(filePath, "utf-8");
  const doc = YAML.parse(raw) as Record<string, unknown>;
  const sops = doc.sops as Record<string, unknown> | undefined;
  if (!sops) throw new Error(`${filePath} is not a SOPS-encrypted file (no sops: block)`);
  delete sops.lastmodified;
  fs.writeFileSync(filePath, YAML.stringify(doc));
}

/**
 * Remove a specific key's rotation record from a `.clef-meta.yaml` sidecar
 * (the file sibling to the encrypted cell).  Simulates "pre-feature" state
 * for that key — per-key policy will report it as `last_rotated_known: false`
 * and fail the compliance gate.
 *
 * The change is committed so the working tree stays clean.  Tests that
 * follow up with UI PUT / DELETE calls run through `tx.run`, which
 * preflight-refuses dirty trees — leaving the edit uncommitted would
 * deterministically 500 those calls.
 */
export function removeRotationRecord(metaFilePath: string, key: string): void {
  if (!fs.existsSync(metaFilePath)) return;
  const raw = fs.readFileSync(metaFilePath, "utf-8");
  const doc = YAML.parse(raw) as {
    version: number;
    pending?: unknown[];
    rotations?: Array<{ key: string }>;
  };
  doc.rotations = (doc.rotations ?? []).filter((r) => r.key !== key);
  const lines = [
    "# Managed by Clef. Do not edit manually.",
    YAML.stringify({ version: doc.version, pending: doc.pending ?? [], rotations: doc.rotations }),
  ];
  fs.writeFileSync(metaFilePath, lines.join("\n"));

  // Commit so the tree is clean for downstream `tx.run`-backed API calls.
  // Use the file's own directory as the git root anchor — the sidecar
  // lives inside the test repo, so its parent dir walks up to it.
  // `git add -A` sweeps up any drift from the enclosing beforeEach
  // (snapshot restores via writeFileSync) in the same commit so the
  // resulting tree is fully clean.
  const repoDir = path.dirname(path.dirname(metaFilePath));
  execFileSync("git", ["add", "-A"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", `test: remove rotation record for ${key}`], {
    cwd: repoDir,
    stdio: "pipe",
  });
}
