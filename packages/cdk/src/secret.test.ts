import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { App, Stack, aws_lambda as lambda } from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
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

describe("ClefSecret", () => {
  let tmpRoot: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "clef-cdk-secret-"));
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
          new ClefSecret(stack, "Secrets", {
            identity: "api",
            environment: "prod",
            manifest: manifestPath,
          }),
      ).toThrow(/requires a KMS-envelope service identity/);
    });

    it("surfaces Record-shape typos with the valid-keys list", () => {
      mockInvokePackHelper.mockReturnValue(
        kmsEnvelopeResult("api", "prod", ["DATABASE_HOST", "DATABASE_USER", "API_KEY"]),
      );

      const app = new App();
      const stack = new Stack(app, "TestStack");

      expect(
        () =>
          new ClefSecret(stack, "Secrets", {
            identity: "api",
            environment: "prod",
            manifest: manifestPath,
            shape: { dbHost: "${DATABSAE_HOST}" }, // typo
          }),
      ).toThrow(/references unknown Clef key: \$\{DATABSAE_HOST\}[\s\S]*DATABASE_HOST/);
    });

    it("surfaces string-shape typos with the valid-keys list", () => {
      mockInvokePackHelper.mockReturnValue(
        kmsEnvelopeResult("api", "prod", ["DB_HOST", "DB_USER", "DB_PASSWORD"]),
      );

      const app = new App();
      const stack = new Stack(app, "TestStack");

      expect(
        () =>
          new ClefSecret(stack, "Secrets", {
            identity: "api",
            environment: "prod",
            manifest: manifestPath,
            shape: "postgres://${DB_USER}:${DB_PASSWROD}@${DB_HOST}", // typo in DB_PASSWORD
          }),
      ).toThrow(/references unknown Clef key: \$\{DB_PASSWROD\}[\s\S]*DB_PASSWORD/);
    });

    it("refuses non-JSON pack-helper output", () => {
      mockInvokePackHelper.mockReturnValue({ envelopeJson: "not json", keys: [] });
      const app = new App();
      const stack = new Stack(app, "TestStack");

      expect(
        () =>
          new ClefSecret(stack, "Secrets", {
            identity: "api",
            environment: "prod",
            manifest: manifestPath,
          }),
      ).toThrow(/non-JSON output/);
    });
  });

  describe("CFN synthesis — passthrough (no shape)", () => {
    let stack: Stack;
    let template: Template;

    beforeEach(() => {
      mockInvokePackHelper.mockReturnValue(
        kmsEnvelopeResult("api", "prod", ["DATABASE_URL", "API_KEY"]),
      );
      const app = new App();
      stack = new Stack(app, "TestStack");
      new ClefSecret(stack, "Secrets", {
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

    it("creates a Custom::ClefSecretGrant with CreateGrant scoped to the unwrap role", () => {
      template.resourceCountIs("Custom::ClefSecretGrant", 1);

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

    it("creates a Custom::ClefSecretUnwrap that depends on the grant", () => {
      template.resourceCountIs("Custom::ClefSecretUnwrap", 1);

      const unwraps = template.findResources("Custom::ClefSecretUnwrap");
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

    it("omits the Shape property on the Unwrap CR (passthrough case)", () => {
      const unwraps = template.findResources("Custom::ClefSecretUnwrap");
      const [props] = Object.values(unwraps).map(
        (r) => (r as { Properties: Record<string, unknown> }).Properties,
      );
      expect(props.Shape).toBeUndefined();
    });
  });

  describe("CFN synthesis — Record shape (JSON secret)", () => {
    it("passes the record shape through to the Unwrap custom resource", () => {
      mockInvokePackHelper.mockReturnValue(
        kmsEnvelopeResult("api", "prod", ["DATABASE_HOST", "API_KEY"]),
      );
      const app = new App();
      const stack = new Stack(app, "TestStack");

      new ClefSecret(stack, "Secrets", {
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
      template.hasResourceProperties("Custom::ClefSecretUnwrap", {
        Shape: {
          dbHost: "${DATABASE_HOST}",
          apiKey: "${API_KEY}",
          region: "us-east-1",
        },
      });
    });
  });

  describe("CFN synthesis — string shape (single-value secret)", () => {
    it("passes the string template through to the Unwrap custom resource", () => {
      mockInvokePackHelper.mockReturnValue(
        kmsEnvelopeResult("api", "prod", ["DB_USER", "DB_PASSWORD", "DB_HOST"]),
      );
      const app = new App();
      const stack = new Stack(app, "TestStack");

      new ClefSecret(stack, "Secrets", {
        identity: "api",
        environment: "prod",
        manifest: manifestPath,
        shape: "postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:5432/app",
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties("Custom::ClefSecretUnwrap", {
        Shape: "postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:5432/app",
      });
    });

    it("passes a literal string (no refs) through to the Unwrap custom resource", () => {
      mockInvokePackHelper.mockReturnValue(kmsEnvelopeResult("api", "prod", ["KEY"]));
      const app = new App();
      const stack = new Stack(app, "TestStack");

      new ClefSecret(stack, "Secrets", {
        identity: "api",
        environment: "prod",
        manifest: manifestPath,
        shape: "${KEY}",
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties("Custom::ClefSecretUnwrap", {
        Shape: "${KEY}",
      });
    });
  });

  describe("grantRead", () => {
    it("issues secretsmanager:GetSecretValue to the consumer only", () => {
      mockInvokePackHelper.mockReturnValue(kmsEnvelopeResult("api", "prod", ["DATABASE_URL"]));
      const app = new App();
      const stack = new Stack(app, "TestStack");

      const secrets = new ClefSecret(stack, "Secrets", {
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

  describe("multiple ClefSecret instances in one stack", () => {
    it("reuses a single UnwrapFn across instances (stack-level singleton)", () => {
      mockInvokePackHelper.mockImplementation(({ identity }: { identity: string }) =>
        kmsEnvelopeResult(identity, "prod", ["DATABASE_URL"]),
      );
      const app = new App();
      const stack = new Stack(app, "TestStack");

      new ClefSecret(stack, "SecretsA", {
        identity: "service-a",
        environment: "prod",
        manifest: manifestPath,
      });
      new ClefSecret(stack, "SecretsB", {
        identity: "service-b",
        environment: "prod",
        manifest: manifestPath,
      });

      const template = Template.fromStack(stack);

      // Two ASM secrets.
      template.resourceCountIs("AWS::SecretsManager::Secret", 2);

      // Exactly one unwrap Lambda — matches by our description prefix. The
      // other Lambdas in the stack are CDK-framework (Provider + AwsCR).
      const functions = template.findResources("AWS::Lambda::Function");
      const unwrapFns = Object.entries(functions).filter(([, res]) => {
        const desc = (res as { Properties: { Description?: string } }).Properties.Description;
        return typeof desc === "string" && desc.startsWith("Clef CDK unwrap");
      });
      expect(unwrapFns).toHaveLength(1);
    });

    it("creates one Custom::ClefSecretUnwrap per construct instance", () => {
      mockInvokePackHelper.mockImplementation(({ identity }: { identity: string }) =>
        kmsEnvelopeResult(identity, "prod", ["DATABASE_URL"]),
      );
      const app = new App();
      const stack = new Stack(app, "TestStack");

      new ClefSecret(stack, "DbUrl", {
        identity: "service-a",
        environment: "prod",
        manifest: manifestPath,
        shape: "${DATABASE_URL}",
      });
      new ClefSecret(stack, "ApiConfig", {
        identity: "service-b",
        environment: "prod",
        manifest: manifestPath,
        shape: { url: "${DATABASE_URL}" },
      });

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::SecretsManager::Secret", 2);
      template.resourceCountIs("Custom::ClefSecretUnwrap", 2);
      template.resourceCountIs("Custom::ClefSecretGrant", 2);
    });
  });
});
