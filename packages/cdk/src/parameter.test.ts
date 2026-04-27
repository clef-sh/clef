import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { App, Stack, aws_kms as kms, aws_lambda as lambda } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { ClefParameter } from "./parameter";
import { ClefSecret } from "./secret";

jest.mock("./pack-invoker");
import { invokePackHelper } from "./pack-invoker";

const mockInvokePackHelper = invokePackHelper as jest.MockedFunction<typeof invokePackHelper>;

const KEY_ARN = "arn:aws:kms:us-east-1:111122223333:key/abc-123-def";

function writeManifest(dir: string): string {
  const p = path.join(dir, "clef.yaml");
  fs.writeFileSync(p, "version: 1\n");
  return p;
}

// Keys are passed as a flat list for terseness; the helpers bucket them
// under namespace `"app"` so test call sites stay readable. Tests that
// need cross-namespace coverage use `kmsEnvelopeResultNs` below.
function kmsEnvelopeResult(
  identity: string,
  environment: string,
  keys: string[],
  keyArn: string = KEY_ARN,
) {
  return kmsEnvelopeResultNs(identity, environment, { app: keys }, keyArn);
}

function kmsEnvelopeResultNs(
  identity: string,
  environment: string,
  keysByNamespace: Record<string, string[]>,
  keyArn: string = KEY_ARN,
) {
  return {
    envelopeJson: JSON.stringify({
      version: 1,
      identity,
      environment,
      packedAt: "2026-01-01T00:00:00.000Z",
      revision: "1700000000-abcd",
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
    keysByNamespace,
  };
}

function ageEnvelopeResult(identity: string, environment: string, keys: string[]) {
  return {
    envelopeJson: JSON.stringify({
      version: 1,
      identity,
      environment,
      packedAt: "2026-01-01T00:00:00.000Z",
      revision: "1700000000-abcd",
      ciphertextHash: "deadbeef",
      ciphertext: "YWdlCg==",
    }),
    keysByNamespace: { app: keys },
  };
}

/** Shared `refs` builder so tests don't repeat the namespace boilerplate. */
function refsFor(keys: Record<string, string>): Record<string, { namespace: string; key: string }> {
  const out: Record<string, { namespace: string; key: string }> = {};
  for (const [alias, key] of Object.entries(keys)) {
    out[alias] = { namespace: "app", key };
  }
  return out;
}

describe("ClefParameter", () => {
  let tmpRoot: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clef-cdk-param-"));
    manifestPath = writeManifest(tmpRoot);
    mockInvokePackHelper.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("synth-time validation", () => {
    it("rejects age-only identities", () => {
      mockInvokePackHelper.mockReturnValue(ageEnvelopeResult("api", "prod", ["DB_URL"]));
      const app = new App();
      const stack = new Stack(app, "TestStack");

      expect(
        () =>
          new ClefParameter(stack, "DbUrl", {
            identity: "api",
            environment: "prod",
            manifest: manifestPath,
            shape: "{{db_url}}",
            refs: refsFor({ db_url: "DB_URL" }),
          }),
      ).toThrow(/requires a KMS-envelope service identity/);
    });

    it("surfaces typos that misspell a ref's key", () => {
      mockInvokePackHelper.mockReturnValue(
        kmsEnvelopeResult("api", "prod", ["DB_HOST", "DB_USER", "DB_PASSWORD"]),
      );
      const app = new App();
      const stack = new Stack(app, "TestStack");

      expect(
        () =>
          new ClefParameter(stack, "DbUrl", {
            identity: "api",
            environment: "prod",
            manifest: manifestPath,
            shape: "postgres://{{user}}:{{pass}}@{{host}}",
            refs: refsFor({ user: "DB_USER", pass: "DB_PASSWROD", host: "DB_HOST" }), // typo
          }),
      ).toThrow(/refs\['pass'\] = app\/DB_PASSWROD not found[\s\S]*DB_PASSWORD/);
    });
  });

  describe("CFN synthesis — defaults", () => {
    let stack: Stack;
    let template: Template;

    beforeEach(() => {
      mockInvokePackHelper.mockReturnValue(kmsEnvelopeResult("api", "prod", ["DB_URL"]));
      const app = new App();
      stack = new Stack(app, "TestStack", {
        env: { account: "111122223333", region: "us-east-1" },
      });
      new ClefParameter(stack, "DbUrl", {
        identity: "api",
        environment: "prod",
        manifest: manifestPath,
        shape: "{{db_url}}",
        refs: refsFor({ db_url: "DB_URL" }),
      });
      template = Template.fromStack(stack);
    });

    it("does NOT create a CFN-managed AWS::SSM::Parameter (Lambda owns lifecycle)", () => {
      template.resourceCountIs("AWS::SSM::Parameter", 0);
    });

    it("creates a Custom::ClefParameterGrant and Custom::ClefParameterUnwrap", () => {
      template.resourceCountIs("Custom::ClefParameterGrant", 1);
      template.resourceCountIs("Custom::ClefParameterUnwrap", 1);
    });

    it("Unwrap CR targets parameter with defaulted name and SecureString type", () => {
      const unwraps = template.findResources("Custom::ClefParameterUnwrap");
      const [props] = Object.values(unwraps).map(
        (r) => (r as { Properties: Record<string, unknown> }).Properties,
      );
      expect(props.Target).toBe("parameter");
      expect(props.ParameterName).toBe("/clef/api/prod/DbUrl");
      expect(props.ParameterType).toBe("SecureString");
      expect(props.Shape).toBe("{{db_url}}");
      // Tier is omitted when not passed — SSM uses Standard by default.
      expect(props.ParameterTier).toBeUndefined();
      // ParameterKmsKeyId is omitted when using aws/ssm default.
      expect(props.ParameterKmsKeyId).toBeUndefined();
    });

    it("grants unwrap Lambda ssm:PutParameter + ssm:DeleteParameter scoped to the parameter", () => {
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(["ssm:PutParameter", "ssm:DeleteParameter"]),
              Effect: "Allow",
            }),
          ]),
        },
      });
    });

    it("unwrap Lambda role has NO baseline kms:Decrypt", () => {
      const policies = template.findResources("AWS::IAM::Policy");
      for (const [, res] of Object.entries(policies)) {
        const doc = (res as { Properties: { PolicyDocument: { Statement: unknown[] } } }).Properties
          .PolicyDocument;
        for (const stmt of doc.Statement) {
          const actions = (stmt as { Action?: string | string[] }).Action;
          const list = Array.isArray(actions) ? actions : actions ? [actions] : [];
          if (list.includes("kms:Decrypt")) {
            fail(
              `Found unexpected kms:Decrypt in an IAM policy — authority must be grant-only:\n` +
                JSON.stringify(stmt, null, 2),
            );
          }
        }
      }
    });

    it("unwrap Lambda has NO baseline kms:Encrypt (aws/ssm default is AWS-managed)", () => {
      const policies = template.findResources("AWS::IAM::Policy");
      for (const [, res] of Object.entries(policies)) {
        const doc = (res as { Properties: { PolicyDocument: { Statement: unknown[] } } }).Properties
          .PolicyDocument;
        for (const stmt of doc.Statement) {
          const actions = (stmt as { Action?: string | string[] }).Action;
          const list = Array.isArray(actions) ? actions : actions ? [actions] : [];
          if (list.includes("kms:Encrypt")) {
            fail(
              `Found unexpected kms:Encrypt — only appears when a custom parameterKmsKey is set:\n` +
                JSON.stringify(stmt, null, 2),
            );
          }
        }
      }
    });
  });

  describe("CFN synthesis — explicit options", () => {
    it("honours explicit parameterName, type, tier, and parameterKmsKey", () => {
      mockInvokePackHelper.mockReturnValue(kmsEnvelopeResult("api", "prod", ["DB_URL"]));
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "111122223333", region: "us-east-1" },
      });

      const atRestKey = kms.Key.fromKeyArn(
        stack,
        "AtRestKey",
        "arn:aws:kms:us-east-1:111122223333:key/at-rest-xyz",
      );

      new ClefParameter(stack, "DbUrl", {
        identity: "api",
        environment: "prod",
        manifest: manifestPath,
        shape: "{{db_url}}",
        refs: refsFor({ db_url: "DB_URL" }),
        parameterName: "/custom/path",
        type: "SecureString",
        tier: "Advanced",
        parameterKmsKey: atRestKey,
      });

      const template = Template.fromStack(stack);
      const unwraps = template.findResources("Custom::ClefParameterUnwrap");
      const [props] = Object.values(unwraps).map(
        (r) => (r as { Properties: Record<string, unknown> }).Properties,
      );
      expect(props.ParameterName).toBe("/custom/path");
      expect(props.ParameterTier).toBe("Advanced");
      expect(props.ParameterKmsKeyId).toBeDefined();
    });

    it("grants kms:Encrypt on a custom parameterKmsKey", () => {
      mockInvokePackHelper.mockReturnValue(kmsEnvelopeResult("api", "prod", ["DB_URL"]));
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "111122223333", region: "us-east-1" },
      });

      const atRestKey = kms.Key.fromKeyArn(
        stack,
        "AtRestKey",
        "arn:aws:kms:us-east-1:111122223333:key/at-rest-xyz",
      );

      new ClefParameter(stack, "DbUrl", {
        identity: "api",
        environment: "prod",
        manifest: manifestPath,
        shape: "{{db_url}}",
        refs: refsFor({ db_url: "DB_URL" }),
        parameterKmsKey: atRestKey,
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(["kms:Encrypt"]),
              Effect: "Allow",
            }),
          ]),
        },
      });
    });
  });

  describe("grantRead", () => {
    it("grants ssm:GetParameter* to the consumer", () => {
      mockInvokePackHelper.mockReturnValue(kmsEnvelopeResult("api", "prod", ["DB_URL"]));
      const app = new App();
      const stack = new Stack(app, "TestStack");

      const param = new ClefParameter(stack, "DbUrl", {
        identity: "api",
        environment: "prod",
        manifest: manifestPath,
        shape: "{{db_url}}",
        refs: refsFor({ db_url: "DB_URL" }),
      });

      const fn = new lambda.Function(stack, "Consumer", {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        code: lambda.Code.fromInline("exports.handler = async () => ({});"),
      });

      param.grantRead(fn);

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([Match.stringLikeRegexp("ssm:GetParameter")]),
              Effect: "Allow",
            }),
          ]),
        },
      });
    });

    it("grants kms:Decrypt on a custom parameterKmsKey for SecureString", () => {
      mockInvokePackHelper.mockReturnValue(kmsEnvelopeResult("api", "prod", ["DB_URL"]));
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "111122223333", region: "us-east-1" },
      });

      const atRestKey = kms.Key.fromKeyArn(
        stack,
        "AtRestKey",
        "arn:aws:kms:us-east-1:111122223333:key/at-rest-xyz",
      );

      const param = new ClefParameter(stack, "DbUrl", {
        identity: "api",
        environment: "prod",
        manifest: manifestPath,
        shape: "{{db_url}}",
        refs: refsFor({ db_url: "DB_URL" }),
        parameterKmsKey: atRestKey,
      });

      const fn = new lambda.Function(stack, "Consumer", {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        code: lambda.Code.fromInline("exports.handler = async () => ({});"),
      });

      param.grantRead(fn);

      const template = Template.fromStack(stack);
      // Find the Consumer role's policy and assert kms:Decrypt is present.
      const policies = template.findResources("AWS::IAM::Policy");
      const consumerPolicies = Object.entries(policies).filter(([, res]) => {
        const roles = (res as { Properties: { Roles?: { Ref?: string }[] } }).Properties.Roles;
        return roles?.some((r) => r.Ref?.includes("Consumer"));
      });
      const hasDecrypt = consumerPolicies.some(([, pol]) => {
        const stmts = (pol as { Properties: { PolicyDocument: { Statement: unknown[] } } })
          .Properties.PolicyDocument.Statement;
        return stmts.some((stmt) => {
          const actions = (stmt as { Action?: string | string[] }).Action;
          const list = Array.isArray(actions) ? actions : actions ? [actions] : [];
          return list.includes("kms:Decrypt");
        });
      });
      expect(hasDecrypt).toBe(true);
    });

    it("does NOT grant kms:Decrypt when using the aws/ssm default key", () => {
      // Matches native ssm.StringParameter.grantRead behaviour: aws/ssm is
      // AWS-managed, grants via IAM aren't tied to it, and typical AWS
      // account policies already allow Decrypt through the SSM integration.
      mockInvokePackHelper.mockReturnValue(kmsEnvelopeResult("api", "prod", ["DB_URL"]));
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "111122223333", region: "us-east-1" },
      });

      const param = new ClefParameter(stack, "DbUrl", {
        identity: "api",
        environment: "prod",
        manifest: manifestPath,
        shape: "{{db_url}}",
        refs: refsFor({ db_url: "DB_URL" }),
      });

      const fn = new lambda.Function(stack, "Consumer", {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        code: lambda.Code.fromInline("exports.handler = async () => ({});"),
      });

      param.grantRead(fn);

      const template = Template.fromStack(stack);
      const policies = template.findResources("AWS::IAM::Policy");
      const consumerPolicies = Object.entries(policies).filter(([, res]) => {
        const roles = (res as { Properties: { Roles?: { Ref?: string }[] } }).Properties.Roles;
        return roles?.some((r) => r.Ref?.includes("Consumer"));
      });
      for (const [, pol] of consumerPolicies) {
        const stmts = (pol as { Properties: { PolicyDocument: { Statement: unknown[] } } })
          .Properties.PolicyDocument.Statement;
        for (const stmt of stmts) {
          const actions = (stmt as { Action?: string | string[] }).Action;
          const list = Array.isArray(actions) ? actions : actions ? [actions] : [];
          if (list.includes("kms:Decrypt")) {
            fail(
              `Default aws/ssm should not add kms:Decrypt to consumer role: ` +
                JSON.stringify(stmt),
            );
          }
        }
      }
    });

    it("does NOT grant kms:Decrypt for String type", () => {
      mockInvokePackHelper.mockReturnValue(kmsEnvelopeResult("api", "prod", ["CONFIG_VALUE"]));
      const app = new App();
      const stack = new Stack(app, "TestStack");

      const param = new ClefParameter(stack, "Config", {
        identity: "api",
        environment: "prod",
        manifest: manifestPath,
        shape: "{{config_value}}",
        refs: refsFor({ config_value: "CONFIG_VALUE" }),
        type: "String",
      });

      const fn = new lambda.Function(stack, "Consumer", {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        code: lambda.Code.fromInline("exports.handler = async () => ({});"),
      });

      param.grantRead(fn);

      const template = Template.fromStack(stack);
      const policies = template.findResources("AWS::IAM::Policy");
      const consumerPolicies = Object.entries(policies).filter(([, res]) => {
        const roles = (res as { Properties: { Roles?: { Ref?: string }[] } }).Properties.Roles;
        return roles?.some((r) => r.Ref?.includes("Consumer"));
      });
      for (const [, pol] of consumerPolicies) {
        const stmts = (pol as { Properties: { PolicyDocument: { Statement: unknown[] } } })
          .Properties.PolicyDocument.Statement;
        for (const stmt of stmts) {
          const actions = (stmt as { Action?: string | string[] }).Action;
          const list = Array.isArray(actions) ? actions : actions ? [actions] : [];
          if (list.includes("kms:Decrypt")) {
            fail(`String-type param should not grant kms:Decrypt: ${JSON.stringify(stmt)}`);
          }
        }
      }
    });
  });

  describe("multiple instances and singleton Lambda reuse", () => {
    it("reuses one unwrap Lambda across multiple ClefParameter instances", () => {
      mockInvokePackHelper.mockImplementation(({ identity }: { identity: string }) =>
        kmsEnvelopeResult(identity, "prod", ["DB_URL", "API_KEY"]),
      );
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "111122223333", region: "us-east-1" },
      });

      new ClefParameter(stack, "DbUrl", {
        identity: "svc-a",
        environment: "prod",
        manifest: manifestPath,
        shape: "{{db_url}}",
        refs: refsFor({ db_url: "DB_URL" }),
      });
      new ClefParameter(stack, "ApiKey", {
        identity: "svc-b",
        environment: "prod",
        manifest: manifestPath,
        shape: "{{api_key}}",
        refs: refsFor({ api_key: "API_KEY" }),
      });

      const template = Template.fromStack(stack);
      template.resourceCountIs("Custom::ClefParameterUnwrap", 2);

      const functions = template.findResources("AWS::Lambda::Function");
      const unwrapFns = Object.entries(functions).filter(([, res]) => {
        const desc = (res as { Properties: { Description?: string } }).Properties.Description;
        return typeof desc === "string" && desc.startsWith("Clef CDK unwrap");
      });
      expect(unwrapFns).toHaveLength(1);
    });

    it("shares the singleton Lambda with ClefSecret instances", () => {
      mockInvokePackHelper.mockImplementation(({ identity }: { identity: string }) =>
        kmsEnvelopeResult(identity, "prod", ["DB_URL"]),
      );
      const app = new App();
      const stack = new Stack(app, "TestStack", {
        env: { account: "111122223333", region: "us-east-1" },
      });

      new ClefSecret(stack, "SecretOne", {
        identity: "svc-a",
        environment: "prod",
        manifest: manifestPath,
      });
      new ClefParameter(stack, "ParamOne", {
        identity: "svc-b",
        environment: "prod",
        manifest: manifestPath,
        shape: "{{db_url}}",
        refs: refsFor({ db_url: "DB_URL" }),
      });

      const template = Template.fromStack(stack);
      const functions = template.findResources("AWS::Lambda::Function");
      const unwrapFns = Object.entries(functions).filter(([, res]) => {
        const desc = (res as { Properties: { Description?: string } }).Properties.Description;
        return typeof desc === "string" && desc.startsWith("Clef CDK unwrap");
      });
      // One shared Lambda across ClefSecret + ClefParameter.
      expect(unwrapFns).toHaveLength(1);
    });
  });
});
