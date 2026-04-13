/**
 * Integration test for service identity CI vs Runtime roles.
 *
 * CI identities: keys are registered as SOPS recipients on encrypted files.
 * Runtime identities: keys are NOT registered (pack-only).
 *
 * Uses real sops + age binaries with temp directories.
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { generateAgeKey, checkSopsAvailable, AgeKeyPair } from "../setup/keys";
import { scaffoldTestRepo, TestRepo } from "../setup/repo";

let keys: AgeKeyPair;
let repo: TestRepo;

beforeAll(async () => {
  checkSopsAvailable();
  keys = await generateAgeKey();
  repo = scaffoldTestRepo(keys);
});

afterAll(() => {
  repo?.cleanup();
  if (keys?.tmpDir) fs.rmSync(keys.tmpDir, { recursive: true, force: true });
});

const clefBin = path.resolve(__dirname, "../../packages/cli/dist/index.cjs");

function clef(args: string[], opts?: { confirm?: boolean }): string {
  return execFileSync("node", [clefBin, ...args], {
    cwd: repo.dir,
    input: opts?.confirm ? "y\n" : "",
    env: { ...process.env, SOPS_AGE_KEY_FILE: keys.keyFilePath },
  }).toString();
}

function readManifest(): Record<string, unknown> {
  return YAML.parse(fs.readFileSync(path.join(repo.dir, "clef.yaml"), "utf-8"));
}

function sopsFileRecipients(encFilePath: string): string[] {
  const raw = YAML.parse(fs.readFileSync(encFilePath, "utf-8"));
  const ageKeys = (raw.sops?.age ?? []) as Array<{ recipient: string }>;
  return ageKeys.map((k) => k.recipient);
}

describe("service identity CI vs Runtime", () => {
  it("should create a CI identity and register its recipient on SOPS files", () => {
    // Create without --json to avoid interaction with confirmation prompts
    clef(["service", "create", "ci-pipeline", "--namespaces", "payments", "--description", "CI"], {
      confirm: true,
    });

    // Verify via manifest: CI identity exists with shared recipient (same key for all envs)
    const manifest = readManifest();
    const identities = manifest.service_identities as Array<Record<string, unknown>>;
    const ciSi = identities.find((si) => si.name === "ci-pipeline");
    expect(ciSi).toBeDefined();
    expect(ciSi!.pack_only).toBeUndefined(); // CI, not runtime

    const envs = ciSi!.environments as Record<string, Record<string, string>>;
    const ciRecipient = envs.dev.recipient;
    expect(ciRecipient).toBeTruthy();

    // Shared recipient: dev and production should have the same key
    expect(envs.production.recipient).toBe(ciRecipient);

    // The CI identity's public key SHOULD appear in the SOPS file metadata
    const devRecipients = sopsFileRecipients(path.join(repo.dir, "payments", "dev.enc.yaml"));
    expect(devRecipients).toContain(ciRecipient);
  });

  it("should create a runtime identity WITHOUT registering its recipient on SOPS files", () => {
    clef(
      [
        "service",
        "create",
        "lambda-worker",
        "--namespaces",
        "payments",
        "--description",
        "Lambda",
        "--runtime",
      ],
      { confirm: true },
    );

    const manifest = readManifest();
    const identities = manifest.service_identities as Array<Record<string, unknown>>;
    const runtimeSi = identities.find((si) => si.name === "lambda-worker");
    expect(runtimeSi).toBeDefined();
    expect(runtimeSi!.pack_only).toBe(true);

    const envs = runtimeSi!.environments as Record<string, Record<string, string>>;
    const runtimeRecipient = envs.dev.recipient;
    expect(runtimeRecipient).toBeTruthy();

    // Runtime default is per-env: dev and production should have DIFFERENT keys
    expect(envs.production.recipient).not.toBe(runtimeRecipient);

    // The runtime identity's public key should NOT appear in the SOPS file metadata
    const devRecipients = sopsFileRecipients(path.join(repo.dir, "payments", "dev.enc.yaml"));
    expect(devRecipients).not.toContain(runtimeRecipient);
  });

  it("clef lint should not report false-positive recipient issues for runtime SIs", () => {
    const output = clef(["lint", "--json"]);
    const result = JSON.parse(output);

    const siIssues = (result.issues as Array<{ category: string; message: string }>).filter(
      (i) => i.category === "service-identity",
    );

    // No recipient_not_registered for the runtime SI
    const runtimeRecipientIssues = siIssues.filter(
      (i) => i.message.includes("lambda-worker") && i.message.includes("recipient is not"),
    );
    expect(runtimeRecipientIssues).toHaveLength(0);
  });
});
