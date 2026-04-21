import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { App, Stack, aws_lambda as lambda } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { ClefAwsSecretsManager } from "./aws-secrets-manager";

jest.mock("./pack-invoker");
import { invokePackHelper } from "./pack-invoker";

const mockInvokePackHelper = invokePackHelper as jest.MockedFunction<typeof invokePackHelper>;

const KEY_ARN = "arn:aws:kms:us-east-1:111122223333:key/abc-123-def";

function writeManifest(dir: string): string {
  const p = path.join(dir, "clef.yaml");
  fs.writeFileSync(p, "version: 1\n");
  return p;
}

function kmsEnvelopeResult(
  identity: string,
  environment: string,
  keys: string[],
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
    keys,
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
    keys,
  };
}

describe("ClefAwsSecretsManager", () => {
  let tmpRoot: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clef-cdk-asm-"));
    manifestPath = writeManifest(tmpRoot);
    mockInvokePackHelper.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe("synth-time validation", () => {
    it("rejects age-only identities with a message pointing at clef.yaml", () => {
      mockInvokePackHelper.mockReturnValue(ageEnvelopeResult("api", "prod", ["DATABASE_URL"]));

      const app = new App();
      const stack = new Stack(app, "TestStack");

      expect(
        () =>
          new ClefAwsSecretsManager(stack, "Secrets", {
            identity: "api",
            environment: "prod",
            manifest: manifestPath,
          }),
      ).toThrow(/requires a KMS-envelope service identity/);
    });

    it("surfaces shape template errors with the valid-keys list", () => {
      mockInvokePackHelper.mockReturnValue(
        kmsEnvelopeResult("api", "prod", ["DATABASE_HOST", "DATABASE_USER", "API_KEY"]),
      );

      const app = new App();
      const stack = new Stack(app, "TestStack");

      expect(
        () =>
          new ClefAwsSecretsManager(stack, "Secrets", {
            identity: "api",
            environment: "prod",
            manifest: manifestPath,
            shape: { dbHost: "${DATABSAE_HOST}" }, // typo
          }),
      ).toThrow(/references unknown Clef key: \$\{DATABSAE_HOST\}[\s\S]*DATABASE_HOST/);
    });

    it("refuses non-JSON pack-helper output", () => {
      mockInvokePackHelper.mockReturnValue({ envelopeJson: "not json", keys: [] });
      const app = new App();
      const stack = new Stack(app, "TestStack");

      expect(
        () =>
          new ClefAwsSecretsManager(stack, "Secrets", {
            identity: "api",
            environment: "prod",
            manifest: manifestPath,
          }),
      ).toThrow(/non-JSON output/);
    });
  });

  describe("CFN synthesis — happy path, no shape (passthrough)", () => {
    let stack: Stack;
    let template: Template;

    beforeEach(() => {
      mockInvokePackHelper.mockReturnValue(
        kmsEnvelopeResult("api", "prod", ["DATABASE_URL", "API_KEY"]),
      );
      const app = new App();
      stack = new Stack(app, "TestStack");
      new ClefAwsSecretsManager(stack, "Secrets", {
        identity: "api",
        environment: "prod",
        manifest: manifestPath,
      });
      template = Template.fromStack(stack);
    });

    it("creates one AWS::SecretsManager::Secret with the default name", () => {
      template.resourceCountIs("AWS::SecretsManager::Secret", 1);
      template.hasResourceProperties("AWS::SecretsManager::Secret", {
        Name: "clef/api/prod",
      });
    });

    it("creates a Custom::ClefAsmGrant with CreateGrant scoped to the unwrap role", () => {
      template.resourceCountIs("Custom::ClefAsmGrant", 1);

      // The AwsCustomResource role's IAM policy carries the scoped CreateGrant
      // statement — this is where the security boundary lives.
      const policies = template.findResources("AWS::IAM::Policy");
      const grantCreatePolicy = Object.entries(policies).find(([, res]) => {
        const stmts = (res as { Properties: { PolicyDocument: { Statement: unknown[] } } })
          .Properties.PolicyDocument.Statement;
        return stmts.some((s) => {
          const actions = (s as { Action?: string | string[] }).Action;
          const list = Array.isArray(actions) ? actions : actions ? [actions] : [];
          return list.includes("kms:CreateGrant");
        });
      });
      expect(grantCreatePolicy).toBeDefined();

      const stmts = (
        grantCreatePolicy![1] as { Properties: { PolicyDocument: { Statement: unknown[] } } }
      ).Properties.PolicyDocument.Statement;
      const createGrantStmt = stmts.find((s) => {
        const actions = (s as { Action?: string | string[] }).Action;
        const list = Array.isArray(actions) ? actions : actions ? [actions] : [];
        return list.includes("kms:CreateGrant");
      }) as {
        Condition?: Record<string, Record<string, unknown>>;
      };

      expect(createGrantStmt.Condition?.StringEquals?.["kms:GranteePrincipal"]).toBeDefined();
      expect(
        createGrantStmt.Condition?.["ForAllValues:StringEquals"]?.["kms:GrantOperations"],
      ).toEqual(["Decrypt"]);
    });

    it("creates a Custom::ClefAsmUnwrap that depends on the grant", () => {
      template.resourceCountIs("Custom::ClefAsmUnwrap", 1);

      const unwraps = template.findResources("Custom::ClefAsmUnwrap");
      const [unwrap] = Object.values(unwraps);
      const deps = (unwrap as { DependsOn?: string[] }).DependsOn;
      expect(deps).toBeDefined();
      // At least one dependency references the GrantCreate resource.
      expect(deps!.some((d) => d.includes("GrantCreate"))).toBe(true);
    });

    it("unwrap Lambda role has NO baseline kms:Decrypt", () => {
      const policies = template.findResources("AWS::IAM::Policy");
      for (const [, res] of Object.entries(policies)) {
        const doc = (res as { Properties: { PolicyDocument: { Statement: unknown[] } } }).Properties
          .PolicyDocument;
        for (const stmt of doc.Statement) {
          const actions = (stmt as { Action?: string | string[] }).Action;
          const list = Array.isArray(actions) ? actions : actions ? [actions] : [];
          // The unwrap Lambda should never hold kms:Decrypt in an IAM
          // policy — that authority is grant-mediated only.
          if (list.includes("kms:Decrypt")) {
            fail(
              `Found unexpected kms:Decrypt in an IAM policy — authority must be grant-only:\n` +
                JSON.stringify(stmt, null, 2),
            );
          }
        }
      }
    });

    it("unwrap Lambda has secretsmanager:PutSecretValue on the target secret", () => {
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([Match.stringLikeRegexp("secretsmanager:PutSecretValue")]),
              Effect: "Allow",
            }),
          ]),
        },
      });
    });
  });

  describe("CFN synthesis — with shape template", () => {
    it("passes the shape through to the Unwrap custom resource", () => {
      mockInvokePackHelper.mockReturnValue(
        kmsEnvelopeResult("api", "prod", ["DATABASE_HOST", "API_KEY"]),
      );
      const app = new App();
      const stack = new Stack(app, "TestStack");

      new ClefAwsSecretsManager(stack, "Secrets", {
        identity: "api",
        environment: "prod",
        manifest: manifestPath,
        shape: {
          dbHost: "${DATABASE_HOST}",
          apiKey: "${API_KEY}",
          region: "us-east-1",
        },
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties("Custom::ClefAsmUnwrap", {
        Shape: {
          dbHost: "${DATABASE_HOST}",
          apiKey: "${API_KEY}",
          region: "us-east-1",
        },
      });
    });

    it("omits the Shape property entirely when none provided", () => {
      mockInvokePackHelper.mockReturnValue(kmsEnvelopeResult("api", "prod", ["DATABASE_URL"]));
      const app = new App();
      const stack = new Stack(app, "TestStack");

      new ClefAwsSecretsManager(stack, "Secrets", {
        identity: "api",
        environment: "prod",
        manifest: manifestPath,
      });

      const template = Template.fromStack(stack);
      const unwraps = template.findResources("Custom::ClefAsmUnwrap");
      const [props] = Object.values(unwraps).map(
        (r) => (r as { Properties: Record<string, unknown> }).Properties,
      );
      expect(props.Shape).toBeUndefined();
    });
  });

  describe("grantRead", () => {
    it("issues secretsmanager:GetSecretValue to the consumer only", () => {
      mockInvokePackHelper.mockReturnValue(kmsEnvelopeResult("api", "prod", ["DATABASE_URL"]));
      const app = new App();
      const stack = new Stack(app, "TestStack");

      const secrets = new ClefAwsSecretsManager(stack, "Secrets", {
        identity: "api",
        environment: "prod",
        manifest: manifestPath,
      });

      const fn = new lambda.Function(stack, "Consumer", {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: "index.handler",
        code: lambda.Code.fromInline("exports.handler = async () => ({});"),
      });

      secrets.grantRead(fn);

      const template = Template.fromStack(stack);
      template.hasResourceProperties("AWS::IAM::Policy", {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([Match.stringLikeRegexp("secretsmanager:GetSecretValue")]),
              Effect: "Allow",
            }),
          ]),
        },
      });
    });
  });

  describe("stack-level singleton Lambda", () => {
    it("reuses one UnwrapFn across multiple ClefAwsSecretsManager instances", () => {
      mockInvokePackHelper.mockImplementation(({ identity }: { identity: string }) =>
        kmsEnvelopeResult(identity, "prod", ["DATABASE_URL"]),
      );
      const app = new App();
      const stack = new Stack(app, "TestStack");

      new ClefAwsSecretsManager(stack, "SecretsA", {
        identity: "service-a",
        environment: "prod",
        manifest: manifestPath,
      });
      new ClefAwsSecretsManager(stack, "SecretsB", {
        identity: "service-b",
        environment: "prod",
        manifest: manifestPath,
      });

      const template = Template.fromStack(stack);

      // Two ASM secrets.
      template.resourceCountIs("AWS::SecretsManager::Secret", 2);

      // Find Lambdas with our description prefix — exactly one is the
      // singleton unwrap handler; the others are CDK-framework Lambdas
      // (Provider onEvent framework + AwsCustomResource auto Lambda).
      const functions = template.findResources("AWS::Lambda::Function");
      const unwrapFns = Object.entries(functions).filter(([, res]) => {
        const desc = (res as { Properties: { Description?: string } }).Properties.Description;
        return typeof desc === "string" && desc.startsWith("Clef ASM unwrap");
      });
      expect(unwrapFns).toHaveLength(1);
    });
  });
});
