/**
 * Integration test for `@clef-sh/cdk` constructs.
 *
 * Exercises the in-process synth path end-to-end:
 *   - real scaffolded clef repo
 *   - real sops binary decrypting source files
 *   - real pack-helper subprocess producing the envelope + keys sidecar
 *   - real CDK App/Stack synthesis
 *
 * KMS-envelope synthesis requires AWS credentials (pack-helper calls
 * kms:Encrypt to wrap the DEK), so the KMS happy-path for
 * ClefAwsSecretsManager is deferred to deploy-time e2e — no cloud calls
 * here. What this suite *does* cover for ASM is the age-identity
 * rejection, since the failure path runs entirely from the pack-helper's
 * output through our synth-time validator.
 */
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { ClefArtifactBucket, ClefParameter, ClefSecret } from "@clef-sh/cdk";
import * as fs from "fs";
import * as path from "path";

import { AgeKeyPair, checkSopsAvailable, generateAgeKey } from "../setup/keys";
import { scaffoldTestRepo, TestRepo } from "../setup/repo";

let keys: AgeKeyPair;
let repo: TestRepo;

beforeAll(async () => {
  checkSopsAvailable();
  try {
    keys = await generateAgeKey();
    repo = scaffoldTestRepo(keys, { includeServiceIdentity: true });
    // pack-helper reads age credentials from CLEF_AGE_KEY_FILE — scaffold
    // produces SOPS_AGE_KEY_FILE style, they're the same file path.
    process.env.CLEF_AGE_KEY_FILE = keys.keyFilePath;
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
});

afterAll(() => {
  delete process.env.CLEF_AGE_KEY_FILE;
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

describe("ClefArtifactBucket — integration with real pack-helper", () => {
  it("synthesises a CFN template with a hardened bucket and envelope deployment", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack", {
      env: { account: "111122223333", region: "us-east-1" },
    });

    const artifact = new ClefArtifactBucket(stack, "Secrets", {
      identity: "web-app",
      environment: "dev",
      manifest: path.join(repo.dir, "clef.yaml"),
    });

    expect(artifact.objectKey).toBe("clef/web-app/dev.json");
    expect(artifact.manifestPath).toBe(path.join(repo.dir, "clef.yaml"));
    // Age identity — no KMS envelope, so envelopeKey is undefined.
    expect(artifact.envelopeKey).toBeUndefined();

    const template = Template.fromStack(stack);

    // Hardened defaults — verify the construct isn't silently dropping
    // security posture somewhere along the real pack-helper path.
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          { ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" } },
        ],
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      VersioningConfiguration: { Status: "Enabled" },
    });

    // The BucketDeployment Custom Resource is wired up.
    template.resourceCountIs("Custom::CDKBucketDeployment", 1);
  });

  it("does not leak plaintext secrets into cdk.out", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack", {
      env: { account: "111122223333", region: "us-east-1" },
    });

    new ClefArtifactBucket(stack, "Secrets", {
      identity: "web-app",
      environment: "dev",
      manifest: path.join(repo.dir, "clef.yaml"),
    });

    const assembly = app.synth();

    // Walk everything CDK emitted (templates, asset zips, manifest JSONs).
    // Plaintext secret *bytes* must not appear — ciphertext is safe, but
    // scaffolded plaintext never should. Raw Buffer byte search is
    // compression-agnostic for zip asset files: if the envelope got
    // zip-compressed, the plaintext byte pattern won't appear in the
    // compressed stream either, which is still a valid guarantee.
    const plaintexts = ["sk_test_abc123", "whsec_xyz789"];
    const visit = (dir: string): void => {
      for (const entry of fs.readdirSync(dir)) {
        const full = path.join(dir, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          visit(full);
        } else {
          const bytes = fs.readFileSync(full);
          for (const needle of plaintexts) {
            if (bytes.indexOf(needle) !== -1) {
              throw new Error(`Plaintext '${needle}' leaked into cdk.out: ${full}`);
            }
          }
        }
      }
    };
    visit(assembly.directory);
  });
});

describe("ClefSecret — integration with real pack-helper", () => {
  it("rejects age-only identities with a clear, actionable message", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack", {
      env: { account: "111122223333", region: "us-east-1" },
    });

    expect(
      () =>
        new ClefSecret(stack, "Secrets", {
          identity: "web-app",
          environment: "dev",
          manifest: path.join(repo.dir, "clef.yaml"),
        }),
    ).toThrow(/requires a KMS-envelope service identity/);
  });

  it("rejects age identities before shape validation runs (early-exit order)", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack", {
      env: { account: "111122223333", region: "us-east-1" },
    });

    // We're still on an age identity (so the construct will throw for that
    // reason before shape validation). Shape-template validation running
    // against real pack-helper output is already covered by the unit tests;
    // this integration test documents that an age identity fails *first* —
    // the age error is actionable, while shape errors against an age
    // envelope would just be noise.
    expect(
      () =>
        new ClefSecret(stack, "Secrets", {
          identity: "web-app",
          environment: "dev",
          manifest: path.join(repo.dir, "clef.yaml"),
          shape: { bogus: "${NOT_A_REAL_KEY}" },
        }),
    ).toThrow(/requires a KMS-envelope service identity/);
  });
});

describe("ClefParameter — integration with real pack-helper", () => {
  it("rejects age-only identities with a clear, actionable message", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack", {
      env: { account: "111122223333", region: "us-east-1" },
    });

    expect(
      () =>
        new ClefParameter(stack, "Param", {
          identity: "web-app",
          environment: "dev",
          manifest: path.join(repo.dir, "clef.yaml"),
          shape: "${STRIPE_KEY}",
        }),
    ).toThrow(/requires a KMS-envelope service identity/);
  });

  it("rejects age identities before shape validation runs (early-exit order)", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack", {
      env: { account: "111122223333", region: "us-east-1" },
    });

    // Bogus shape against an age identity — documents that the age error
    // surfaces first. A shape typo against an envelope the Lambda can't
    // decrypt would be noise; the age error is the actionable fix.
    expect(
      () =>
        new ClefParameter(stack, "Param", {
          identity: "web-app",
          environment: "dev",
          manifest: path.join(repo.dir, "clef.yaml"),
          shape: "${NOT_A_REAL_KEY}",
        }),
    ).toThrow(/requires a KMS-envelope service identity/);
  });
});
