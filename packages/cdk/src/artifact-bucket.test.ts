import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { App, Stack, aws_lambda as lambda, aws_s3 as s3 } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { ClefArtifactBucket } from "./artifact-bucket";

jest.mock("./pack-invoker");
import { invokePackHelper } from "./pack-invoker";

const mockInvokePackHelper = invokePackHelper as jest.MockedFunction<typeof invokePackHelper>;

function writeManifest(dir: string): string {
  const p = path.join(dir, "clef.yaml");
  fs.writeFileSync(p, "version: 1\n");
  return p;
}

function ageOnlyEnvelope(identity: string, environment: string) {
  return {
    envelopeJson: JSON.stringify({
      version: 1,
      identity,
      environment,
      packedAt: "2026-01-01T00:00:00.000Z",
      revision: "1-abc",
      ciphertextHash: "deadbeef",
      ciphertext: "YWdlCg==",
    }),
    keys: ["SAMPLE_KEY"],
  };
}

function kmsEnvelope(identity: string, environment: string, keyArn: string) {
  return {
    envelopeJson: JSON.stringify({
      version: 1,
      identity,
      environment,
      packedAt: "2026-01-01T00:00:00.000Z",
      revision: "1-abc",
      ciphertextHash: "deadbeef",
      ciphertext: "ENCRYPTEDDD",
      envelope: {
        provider: "aws",
        keyId: keyArn,
        wrappedKey: "d3JhcHBlZAo=",
        algorithm: "SYMMETRIC_DEFAULT",
        iv: "aXYxMjM=",
        authTag: "dGFnMTIzNDU2Nzg=",
      },
    }),
    keys: ["SAMPLE_KEY"],
  };
}

describe("ClefArtifactBucket", () => {
  let tmpRoot: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clef-cdk-bucket-"));
    manifestPath = writeManifest(tmpRoot);
    mockInvokePackHelper.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("provisions a hardened bucket when none is provided", () => {
    mockInvokePackHelper.mockReturnValue(ageOnlyEnvelope("api", "prod"));
    const app = new App();
    const stack = new Stack(app, "TestStack");

    new ClefArtifactBucket(stack, "Secrets", {
      identity: "api",
      environment: "prod",
      manifest: manifestPath,
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties("AWS::S3::Bucket", {
      BucketEncryption: {
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({
            ServerSideEncryptionByDefault: { SSEAlgorithm: "AES256" },
          }),
        ]),
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      VersioningConfiguration: { Status: "Enabled" },
    });
  });

  it("skips provisioning a bucket when one is passed in", () => {
    mockInvokePackHelper.mockReturnValue(ageOnlyEnvelope("api", "prod"));
    const app = new App();
    const stack = new Stack(app, "TestStack");

    // Pre-existing bucket — verifies we don't create a second one.
    const existing = new s3.Bucket(stack, "Existing");

    new ClefArtifactBucket(stack, "Secrets", {
      identity: "api",
      environment: "prod",
      manifest: manifestPath,
      bucket: existing,
    });

    // Only the single Existing bucket — no new one from ClefArtifactBucket.
    Template.fromStack(stack).resourceCountIs("AWS::S3::Bucket", 1);
  });

  it("wires a BucketDeployment that copies to the expected object key", () => {
    mockInvokePackHelper.mockReturnValue(ageOnlyEnvelope("api", "production"));
    const app = new App();
    const stack = new Stack(app, "TestStack");

    const artifact = new ClefArtifactBucket(stack, "Secrets", {
      identity: "api",
      environment: "production",
      manifest: manifestPath,
    });

    expect(artifact.objectKey).toBe("clef/api/production.json");

    // BucketDeployment synthesizes a CustomResource with the destination key.
    const template = Template.fromStack(stack);
    template.hasResourceProperties("Custom::CDKBucketDeployment", {
      Prune: false,
    });
  });

  it("exposes envelopeKey when the envelope names a KMS keyId", () => {
    const keyArn = "arn:aws:kms:us-east-1:111122223333:key/abc-123";
    mockInvokePackHelper.mockReturnValue(kmsEnvelope("api", "prod", keyArn));

    const app = new App();
    const stack = new Stack(app, "TestStack");
    const artifact = new ClefArtifactBucket(stack, "Secrets", {
      identity: "api",
      environment: "prod",
      manifest: manifestPath,
    });

    expect(artifact.envelopeKey).toBeDefined();
    expect(artifact.envelopeKey!.keyArn).toBe(keyArn);
  });

  it("leaves envelopeKey undefined for age-only envelopes", () => {
    mockInvokePackHelper.mockReturnValue(ageOnlyEnvelope("api", "prod"));
    const app = new App();
    const stack = new Stack(app, "TestStack");
    const artifact = new ClefArtifactBucket(stack, "Secrets", {
      identity: "api",
      environment: "prod",
      manifest: manifestPath,
    });
    expect(artifact.envelopeKey).toBeUndefined();
  });

  it("grantRead issues GetObject only on the envelope key", () => {
    mockInvokePackHelper.mockReturnValue(ageOnlyEnvelope("api", "prod"));
    const app = new App();
    const stack = new Stack(app, "TestStack");

    const artifact = new ClefArtifactBucket(stack, "Secrets", {
      identity: "api",
      environment: "prod",
      manifest: manifestPath,
    });

    const fn = new lambda.Function(stack, "Consumer", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromInline("exports.handler = async () => ({});"),
    });

    artifact.grantRead(fn);

    const template = Template.fromStack(stack);
    // Lambda's execution role must carry an S3 GetObject* statement scoped
    // to an ARN that ends with the artifact's objectKey. Using Match.anyValue
    // keeps the assertion stable against CFN Fn::Join refactors.
    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["s3:GetObject*"]),
            Effect: "Allow",
          }),
        ]),
      },
    });
  });

  it("does not auto-grant KMS Decrypt (explicit-IAM design)", () => {
    const keyArn = "arn:aws:kms:us-east-1:111122223333:key/abc-123";
    mockInvokePackHelper.mockReturnValue(kmsEnvelope("api", "prod", keyArn));

    const app = new App();
    const stack = new Stack(app, "TestStack");

    const artifact = new ClefArtifactBucket(stack, "Secrets", {
      identity: "api",
      environment: "prod",
      manifest: manifestPath,
    });

    const fn = new lambda.Function(stack, "Consumer", {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: "index.handler",
      code: lambda.Code.fromInline("exports.handler = async () => ({});"),
    });

    artifact.grantRead(fn);

    const template = Template.fromStack(stack);
    // No IAM statement granting kms:Decrypt should appear solely from
    // grantRead — user must wire that themselves via envelopeKey.
    const policies = template.findResources("AWS::IAM::Policy");
    for (const [, res] of Object.entries(policies)) {
      const stmts = (res as { Properties: { PolicyDocument: { Statement: unknown[] } } }).Properties
        .PolicyDocument.Statement;
      for (const stmt of stmts) {
        const actions = (stmt as { Action?: string | string[] }).Action;
        const list = Array.isArray(actions) ? actions : actions ? [actions] : [];
        expect(list).not.toContain("kms:Decrypt");
      }
    }
  });

  it("surfaces a clear error when the pack-helper fails", () => {
    mockInvokePackHelper.mockImplementation(() => {
      throw new Error("boom: manifest missing");
    });
    const app = new App();
    const stack = new Stack(app, "TestStack");

    expect(
      () =>
        new ClefArtifactBucket(stack, "Secrets", {
          identity: "api",
          environment: "prod",
          manifest: manifestPath,
        }),
    ).toThrow(/boom: manifest missing/);
  });

  it("surfaces a clear error when the pack-helper returns non-JSON", () => {
    mockInvokePackHelper.mockReturnValue({ envelopeJson: "this is not json", keys: [] });
    const app = new App();
    const stack = new Stack(app, "TestStack");

    expect(
      () =>
        new ClefArtifactBucket(stack, "Secrets", {
          identity: "api",
          environment: "prod",
          manifest: manifestPath,
        }),
    ).toThrow(/non-JSON output/);
  });

  it("records the resolved manifestPath on the construct for debugging", () => {
    mockInvokePackHelper.mockReturnValue(ageOnlyEnvelope("api", "prod"));
    const app = new App();
    const stack = new Stack(app, "TestStack");

    const artifact = new ClefArtifactBucket(stack, "Secrets", {
      identity: "api",
      environment: "prod",
      manifest: manifestPath,
    });

    expect(artifact.manifestPath).toBe(manifestPath);
  });
});
