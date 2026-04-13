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

function sopsFileRecipients(encFilePath: string): string[] {
  const raw = YAML.parse(fs.readFileSync(encFilePath, "utf-8"));
  const ageKeys = (raw.sops?.age ?? []) as Array<{ recipient: string }>;
  return ageKeys.map((k) => k.recipient);
}

describe("service identity CI vs Runtime", () => {
  let ciOutput: string;
  let runtimeOutput: string;

  it("should create a CI identity and register its recipient on SOPS files", () => {
    ciOutput = clef(
      [
        "service",
        "create",
        "ci-pipeline",
        "--namespaces",
        "payments",
        "--description",
        "CI pipeline",
        "--json",
      ],
      { confirm: true },
    );

    const result = JSON.parse(ciOutput);
    expect(result.action).toBe("created");
    expect(result.sharedRecipient).toBe(true); // CI default

    // The CI identity's public key should appear in the SOPS file metadata
    const manifest = YAML.parse(fs.readFileSync(path.join(repo.dir, "clef.yaml"), "utf-8"));
    const ciSi = manifest.service_identities.find(
      (si: Record<string, unknown>) => si.name === "ci-pipeline",
    );
    const ciRecipient = ciSi.environments.dev.recipient;

    const devRecipients = sopsFileRecipients(path.join(repo.dir, "payments", "dev.enc.yaml"));
    expect(devRecipients).toContain(ciRecipient);
  });

  it("should create a runtime identity WITHOUT registering its recipient on SOPS files", () => {
    runtimeOutput = clef(
      [
        "service",
        "create",
        "lambda-worker",
        "--namespaces",
        "payments",
        "--description",
        "Lambda runtime",
        "--runtime",
        "--json",
      ],
      { confirm: true },
    );

    const result = JSON.parse(runtimeOutput);
    expect(result.action).toBe("created");
    expect(result.packOnly).toBe(true);
    expect(result.sharedRecipient).toBe(false); // Runtime default

    // The runtime identity's public key should NOT appear in the SOPS file metadata
    const manifest = YAML.parse(fs.readFileSync(path.join(repo.dir, "clef.yaml"), "utf-8"));
    const runtimeSi = manifest.service_identities.find(
      (si: Record<string, unknown>) => si.name === "lambda-worker",
    );
    const runtimeRecipient = runtimeSi.environments.dev.recipient;

    const devRecipients = sopsFileRecipients(path.join(repo.dir, "payments", "dev.enc.yaml"));
    expect(devRecipients).not.toContain(runtimeRecipient);
  });

  it("should store pack_only: true in the manifest for runtime identities", () => {
    const manifest = YAML.parse(fs.readFileSync(path.join(repo.dir, "clef.yaml"), "utf-8"));
    const runtimeSi = manifest.service_identities.find(
      (si: Record<string, unknown>) => si.name === "lambda-worker",
    );
    expect(runtimeSi.pack_only).toBe(true);

    const ciSi = manifest.service_identities.find(
      (si: Record<string, unknown>) => si.name === "ci-pipeline",
    );
    expect(ciSi.pack_only).toBeUndefined();
  });

  it("clef lint should not report false-positive recipient issues for runtime SIs", () => {
    // Lint should pass without errors — the runtime SI's recipient not being
    // on the SOPS file is expected, not a drift issue.
    const output = clef(["lint", "--json"]);
    const result = JSON.parse(output);

    // Filter to SI-related issues only
    const siIssues = result.issues.filter(
      (i: { category: string }) => i.category === "service-identity",
    );

    // There should be no recipient_not_registered for the runtime SI
    const runtimeRecipientIssues = siIssues.filter(
      (i: { message: string }) =>
        i.message.includes("lambda-worker") && i.message.includes("recipient"),
    );
    expect(runtimeRecipientIssues).toHaveLength(0);
  });
});
