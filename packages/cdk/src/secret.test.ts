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

function ageEnvelopeResult(
  identity: string,
  environment: string,
  keysByNamespace: Record<string, string[]>,
) {
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
    keysByNamespace,
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
      mockInvokePackHelper.mockReturnValue(
        ageEnvelopeResult("api", "prod", { app: ["DATABASE_URL"] }),
      );

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

    it("surfaces typos that misspell a ref's key", () => {
      mockInvokePackHelper.mockReturnValue(
        kmsEnvelopeResult("api", "prod", {
          database: ["DATABASE_HOST", "DATABASE_USER"],
          api: ["API_KEY"],
        }),
      );

      const app = new App();
      const stack = new Stack(app, "TestStack");

      expect(
        () =>
          new ClefSecret(stack, "Secrets", {
            identity: "api",
            environment: "prod",
            manifest: manifestPath,
            shape: { dbHost: "{{host}}" },
            refs: { host: { namespace: "database", key: "DATABSAE_HOST" } }, // typo
          }),
      ).toThrow(/database\/DATABSAE_HOST not found[\s\S]*DATABASE_HOST/);
    });

    it("surfaces typos that misspell a placeholder name", () => {
      mockInvokePackHelper.mockReturnValue(
        kmsEnvelopeResult("api", "prod", { database: ["DB_HOST", "DB_USER", "DB_PASSWORD"] }),
      );

      const app = new App();
      const stack = new Stack(app, "TestStack");

      expect(
        () =>
          new ClefSecret(stack, "Secrets", {
            identity: "api",
            environment: "prod",
            manifest: manifestPath,
            shape: "postgres://{{user}}:{{passwrd}}@{{host}}", // typo: passwrd
            refs: {
              user: { namespace: "database", key: "DB_USER" },
              pass: { namespace: "database", key: "DB_PASSWORD" },
              host: { namespace: "database", key: "DB_HOST" },
            },
          }),
      ).toThrow(/\{\{passwrd\}\} which is not declared/);
    });

    it("refuses non-JSON pack-helper output", () => {
      mockInvokePackHelper.mockReturnValue({ envelopeJson: "not json", keysByNamespace: {} });
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
        kmsEnvelopeResult("api", "prod", { app: ["DATABASE_URL", "API_KEY"] }),
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
    it("passes shape and refs through to the Unwrap custom resource", () => {
      mockInvokePackHelper.mockReturnValue(
        kmsEnvelopeResult("api", "prod", { database: ["DATABASE_HOST"], api: ["API_KEY"] }),
      );
      const app = new App();
      const stack = new Stack(app, "TestStack");

      const refs = {
        host: { namespace: "database", key: "DATABASE_HOST" },
        token: { namespace: "api", key: "API_KEY" },
      };
      new ClefSecret(stack, "Secrets", {
        identity: "api",
        environment: "prod",
        manifest: manifestPath,
        shape: {
          dbHost: "{{host}}",
          apiKey: "{{token}}",
          region: "us-east-1",
        },
        refs,
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties("Custom::ClefSecretUnwrap", {
        Shape: {
          dbHost: "{{host}}",
          apiKey: "{{token}}",
          region: "us-east-1",
        },
        Refs: refs,
      });
    });
  });

  describe("CFN synthesis — string shape (single-value secret)", () => {
    it("passes shape and refs through to the Unwrap custom resource", () => {
      mockInvokePackHelper.mockReturnValue(
        kmsEnvelopeResult("api", "prod", { database: ["DB_USER", "DB_PASSWORD", "DB_HOST"] }),
      );
      const app = new App();
      const stack = new Stack(app, "TestStack");

      const refs = {
        user: { namespace: "database", key: "DB_USER" },
        pass: { namespace: "database", key: "DB_PASSWORD" },
        host: { namespace: "database", key: "DB_HOST" },
      };
      new ClefSecret(stack, "Secrets", {
        identity: "api",
        environment: "prod",
        manifest: manifestPath,
        shape: "postgres://{{user}}:{{pass}}@{{host}}:5432/app",
        refs,
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties("Custom::ClefSecretUnwrap", {
        Shape: "postgres://{{user}}:{{pass}}@{{host}}:5432/app",
        Refs: refs,
      });
    });

    it("passes a literal string (no refs) through to the Unwrap custom resource", () => {
      mockInvokePackHelper.mockReturnValue(kmsEnvelopeResult("api", "prod", { app: ["KEY"] }));
      const app = new App();
      const stack = new Stack(app, "TestStack");

      new ClefSecret(stack, "Secrets", {
        identity: "api",
        environment: "prod",
        manifest: manifestPath,
        shape: "static-no-placeholders",
      });

      const template = Template.fromStack(stack);
      template.hasResourceProperties("Custom::ClefSecretUnwrap", {
        Shape: "static-no-placeholders",
      });
    });
  });

  describe("grantRead", () => {
    it("issues secretsmanager:GetSecretValue to the consumer only", () => {
      mockInvokePackHelper.mockReturnValue(
        kmsEnvelopeResult("api", "prod", { app: ["DATABASE_URL"] }),
      );
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
        kmsEnvelopeResult(identity, "prod", { app: ["DATABASE_URL"] }),
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
        kmsEnvelopeResult(identity, "prod", { app: ["DATABASE_URL"] }),
      );
      const app = new App();
      const stack = new Stack(app, "TestStack");

      new ClefSecret(stack, "DbUrl", {
        identity: "service-a",
        environment: "prod",
        manifest: manifestPath,
        shape: "{{url}}",
        refs: { url: { namespace: "app", key: "DATABASE_URL" } },
      });
      new ClefSecret(stack, "ApiConfig", {
        identity: "service-b",
        environment: "prod",
        manifest: manifestPath,
        shape: { url: "{{url}}" },
        refs: { url: { namespace: "app", key: "DATABASE_URL" } },
      });

      const template = Template.fromStack(stack);
      template.resourceCountIs("AWS::SecretsManager::Secret", 2);
      template.resourceCountIs("Custom::ClefSecretUnwrap", 2);
      template.resourceCountIs("Custom::ClefSecretGrant", 2);
    });

    it("issues distinct KMS grant Names per construct even when identity/env/revision match", () => {
      // Regression: KMS treats two grants with identical key + grantee +
      // operations + name as the same grant and returns one GrantId. Two
      // ClefSecrets sharing identity/env/revision (and the singleton unwrap
      // Lambda role) used to collide → second revoke 404'd on stack delete.
      mockInvokePackHelper.mockImplementation(({ identity }: { identity: string }) =>
        kmsEnvelopeResult(identity, "production", { payments: ["STRIPE_KEY"] }),
      );
      const app = new App();
      const stack = new Stack(app, "TestStack");

      new ClefSecret(stack, "StripeKey", {
        identity: "app",
        environment: "production",
        manifest: manifestPath,
        shape: "{{key}}",
        refs: { key: { namespace: "payments", key: "STRIPE_KEY" } },
      });
      new ClefSecret(stack, "PaymentsConfig", {
        identity: "app",
        environment: "production",
        manifest: manifestPath,
        shape: { key: "{{key}}" },
        refs: { key: { namespace: "payments", key: "STRIPE_KEY" } },
      });

      const template = Template.fromStack(stack);
      const grants = template.findResources("Custom::ClefSecretGrant");
      // Create is rendered as Fn::Join with a token (the unwrap role ARN)
      // spliced in. Stringify the whole thing and pull out the literal
      // Name field — that's all this test cares about.
      const names = Object.values(grants).map((res) => {
        const create = (res as { Properties: { Create: unknown } }).Properties.Create;
        const m = JSON.stringify(create).match(/\\"Name\\":\\"([^"\\]+)\\"/);
        if (!m) throw new Error("could not extract Name from Create");
        return m[1];
      });
      expect(names).toHaveLength(2);
      expect(new Set(names).size).toBe(2);
    });
  });
});
