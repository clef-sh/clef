/**
 * Integration test for `@clef-sh/runtime` consumed as a library.
 *
 * Closes the only-unit-tested gap on the runtime package: today every source
 * shape is unit-tested with `age-encryption` mocked, so a real-decrypt
 * regression in `ClefRuntime` glue (source resolution, poller wiring,
 * AgeDecryptor) would slip past the suite.
 *
 * This file produces a real artifact via `clef pack` (real SOPS, real age,
 * the same path users hit), then loads it through `ClefRuntime` exactly the
 * way a Vercel serverless function or Lambda layer would — no mocks. Because
 * `age-encryption` is ESM-only and Jest runs CJS, the runtime is exercised
 * via a thin `.mjs` subprocess (`runtime-decrypt-helper.mjs`), mirroring the
 * existing `age-keygen-helper.mjs` pattern.
 *
 * Covers the source shapes that direct-runtime consumers actually use:
 *   - `FileArtifactSource` — artifact mounted on disk (Lambda layer, etc.)
 *   - `InlineArtifactSource` from a parsed object (Vercel `import x from "./x.json"`)
 *   - `InlineArtifactSource` from a JSON string (manual instance)
 *   - Wrong age key → real decrypt failure (proves we're not stubbed)
 *
 * Out of scope: HTTP/S3/VCS sources need network fixtures; KMS envelope
 * needs LocalStack or a `kmsProvider` injection on `RuntimeConfig`.
 */
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { generateAgeKey, checkSopsAvailable, AgeKeyPair } from "../setup/keys";
import { scaffoldTestRepo, TestRepo } from "../setup/repo";

let keys: AgeKeyPair;
let repo: TestRepo;
let artifactPath: string;
let artifactJson: string;
let serviceKey: string;

const clefBin = path.resolve(__dirname, "../../packages/cli/dist/index.cjs");
const helperPath = path.resolve(__dirname, "../setup/runtime-decrypt-helper.mjs");

interface DecryptResult {
  ok: boolean;
  ready?: boolean;
  revision?: string;
  secrets?: Record<string, Record<string, string>>;
  error?: string;
}

function runRuntimeHelper(input: {
  mode: "file" | "inline-object" | "inline-string";
  sourcePath?: string;
  sourceJson?: string;
  ageKey: string;
}): DecryptResult {
  const stdout = execFileSync(process.execPath, [helperPath], {
    input: JSON.stringify(input),
    encoding: "utf-8",
  });
  return JSON.parse(stdout) as DecryptResult;
}

beforeAll(async () => {
  checkSopsAvailable();
  try {
    keys = await generateAgeKey();
    repo = scaffoldTestRepo(keys, { includeServiceIdentity: true });
  } catch (err) {
    if (keys?.tmpDir) {
      try {
        fs.rmSync(keys.tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
    repo?.cleanup();
    throw err;
  }

  if (!repo.serviceIdentityPrivateKey) {
    throw new Error("scaffoldTestRepo did not return a service identity private key");
  }
  serviceKey = repo.serviceIdentityPrivateKey;

  artifactPath = path.join(repo.dir, "artifact.json");
  execFileSync("node", [clefBin, "pack", "web-app", "production", "--output", artifactPath], {
    cwd: repo.dir,
    env: { ...process.env, SOPS_AGE_KEY_FILE: keys.keyFilePath },
    encoding: "utf-8",
  });

  artifactJson = fs.readFileSync(artifactPath, "utf-8");
});

afterAll(() => {
  try {
    repo?.cleanup();
  } finally {
    if (keys?.tmpDir) {
      try {
        fs.rmSync(keys.tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  }
});

describe("@clef-sh/runtime roundtrip", () => {
  it("decrypts a packed artifact via FileArtifactSource (string source = path)", () => {
    const result = runRuntimeHelper({
      mode: "file",
      sourcePath: artifactPath,
      ageKey: serviceKey,
    });

    expect(result.ok).toBe(true);
    expect(result.ready).toBe(true);
    expect(result.secrets).toEqual({
      payments: {
        STRIPE_KEY: "sk_live_prod456",
        STRIPE_WEBHOOK_SECRET: "whsec_prod_abc",
      },
    });
  });

  it("decrypts a packed artifact via InlineArtifactSource (parsed PackedArtifact)", () => {
    // The Vercel pattern: bundle the artifact JSON, import it as a module,
    // pass the parsed object directly to createRuntime.
    const result = runRuntimeHelper({
      mode: "inline-object",
      sourceJson: artifactJson,
      ageKey: serviceKey,
    });

    expect(result.ok).toBe(true);
    expect(result.ready).toBe(true);
    expect(result.secrets?.payments?.STRIPE_KEY).toBe("sk_live_prod456");
    expect(result.secrets?.payments?.STRIPE_WEBHOOK_SECRET).toBe("whsec_prod_abc");
  });

  it("decrypts a packed artifact via a pre-built InlineArtifactSource(string)", () => {
    const result = runRuntimeHelper({
      mode: "inline-string",
      sourceJson: artifactJson,
      ageKey: serviceKey,
    });

    expect(result.ok).toBe(true);
    expect(result.secrets?.payments?.STRIPE_KEY).toBe("sk_live_prod456");
  });

  it("rejects a packed artifact when the age key does not match the recipient", async () => {
    // A fresh keypair never recipient-listed for this artifact. Real age
    // decrypt must fail — under the unit-test mock this would silently pass.
    const wrongKeys = await generateAgeKey();
    try {
      const wrongKey = wrongKeys.privateKey
        .split("\n")
        .find((l) => l.startsWith("AGE-SECRET-KEY-"));
      if (!wrongKey) throw new Error("could not extract wrong age key");

      const result = runRuntimeHelper({
        mode: "inline-object",
        sourceJson: artifactJson,
        ageKey: wrongKey,
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    } finally {
      try {
        fs.rmSync(wrongKeys.tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore
      }
    }
  });
});
