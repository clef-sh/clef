import * as fs from "fs";
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  ListSecretsCommand,
  PutSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
  TagResourceCommand,
} from "@aws-sdk/client-secrets-manager";
import { mockClient } from "aws-sdk-client-mock";
import type {
  ClefManifest,
  DecryptedFile,
  EncryptionBackend,
  PackRequest,
  SubprocessRunner,
} from "@clef-sh/core";

import backendDefault, { AwsSecretsManagerBackend } from "./index";

jest.mock("fs");
const mockFs = fs as jest.Mocked<typeof fs>;

const asmMock = mockClient(SecretsManagerClient);

function manifest(): ClefManifest {
  return {
    version: 1,
    environments: [
      { name: "dev", description: "dev" },
      { name: "prod", description: "prod" },
    ],
    namespaces: [
      { name: "api", description: "api" },
      { name: "billing", description: "billing" },
    ],
    sops: { default_backend: "age" },
    file_pattern: "{namespace}/{environment}.enc.yaml",
    service_identities: [
      {
        name: "api-gateway",
        description: "api gateway",
        namespaces: ["api"],
        environments: {
          dev: { recipient: "age1devkey" },
          prod: { recipient: "age1prodkey" },
        },
      },
      {
        name: "multi",
        description: "multi-namespace",
        namespaces: ["api", "billing"],
        environments: {
          dev: { recipient: "age1multidev" },
        },
      },
    ],
  };
}

function mockEncryption(values: Record<string, string>): jest.Mocked<EncryptionBackend> {
  const decrypted: DecryptedFile = {
    values,
    metadata: { backend: "age", recipients: ["age1devkey"], lastModified: new Date() },
  };
  return {
    decrypt: jest.fn().mockResolvedValue(decrypted),
    encrypt: jest.fn(),
    reEncrypt: jest.fn(),
    addRecipient: jest.fn(),
    removeRecipient: jest.fn(),
    validateEncryption: jest.fn(),
    getMetadata: jest.fn(),
  };
}

function fakeRunner(): SubprocessRunner {
  return {
    run: jest.fn(),
    runWithStdin: jest.fn(),
  } as unknown as SubprocessRunner;
}

function fakeRequest(overrides: Partial<PackRequest> = {}): PackRequest {
  return {
    identity: "api-gateway",
    environment: "dev",
    manifest: manifest(),
    repoRoot: "/repo",
    services: {
      encryption: mockEncryption({ DB_PASSWORD: "p@ss", API_KEY: "secret" }),
      runner: fakeRunner(),
    },
    backendOptions: { prefix: "myapp/dev" },
    ...overrides,
  };
}

function notFound(): ResourceNotFoundException {
  return new ResourceNotFoundException({
    $metadata: {},
    message: "Secrets Manager can't find the specified secret.",
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  asmMock.reset();
  mockFs.existsSync.mockImplementation((p) => String(p).includes(".enc.yaml"));
});

describe("AwsSecretsManagerBackend.validateOptions", () => {
  const backend = new AwsSecretsManagerBackend();

  it("rejects missing prefix", () => {
    expect(() => backend.validateOptions({})).toThrow(/requires 'prefix'/);
  });

  it("rejects prefix with disallowed characters", () => {
    expect(() => backend.validateOptions({ prefix: "myapp/dev with spaces" })).toThrow(
      /must match/,
    );
  });

  it("rejects unknown mode values", () => {
    expect(() => backend.validateOptions({ prefix: "x", mode: "fancy" })).toThrow(
      /'json' or 'single'/,
    );
  });

  it("rejects prune=true combined with mode=json", () => {
    expect(() => backend.validateOptions({ prefix: "x", mode: "json", prune: "true" })).toThrow(
      /only applies to 'mode=single'/,
    );
  });

  it("accepts prune=true when mode=single", () => {
    expect(() =>
      backend.validateOptions({ prefix: "x", mode: "single", prune: "true" }),
    ).not.toThrow();
  });

  it("rejects recovery-days outside the 7-30 range", () => {
    expect(() => backend.validateOptions({ prefix: "x", "recovery-days": "0" })).toThrow(
      /between 7 and 30/,
    );
    expect(() => backend.validateOptions({ prefix: "x", "recovery-days": "31" })).toThrow(
      /between 7 and 30/,
    );
  });

  it("rejects non-integer recovery-days", () => {
    expect(() => backend.validateOptions({ prefix: "x", "recovery-days": "10.5" })).toThrow(
      /between 7 and 30/,
    );
  });

  it("accepts a fully-specified options bag", () => {
    expect(() =>
      backend.validateOptions({
        prefix: "myapp/prod",
        mode: "single",
        region: "us-east-1",
        "kms-key-id": "alias/custom",
        prune: "true",
        "recovery-days": "14",
        "tag-prefix": "myco-",
      }),
    ).not.toThrow();
  });
});

describe("AwsSecretsManagerBackend.pack — JSON mode (default)", () => {
  function build(): AwsSecretsManagerBackend {
    return new AwsSecretsManagerBackend(() => new SecretsManagerClient({}));
  }

  it("default export advertises the expected id", () => {
    expect(backendDefault.id).toBe("aws-secrets-manager");
    expect(typeof backendDefault.pack).toBe("function");
  });

  it("treats unset mode as JSON and emits a single PutSecretValue", async () => {
    asmMock.on(PutSecretValueCommand).resolves({});
    asmMock.on(TagResourceCommand).resolves({});

    const result = await build().pack(fakeRequest());

    const puts = asmMock.commandCalls(PutSecretValueCommand);
    expect(puts).toHaveLength(1);
    expect(puts[0].args[0].input.SecretId).toBe("myapp/dev");

    const parsed = JSON.parse(puts[0].args[0].input.SecretString as string);
    expect(parsed).toEqual({ API_KEY: "secret", DB_PASSWORD: "p@ss" });
    // Sorted-by-key serialization keeps ASM history diffs stable.
    expect(Object.keys(parsed)).toEqual(["API_KEY", "DB_PASSWORD"]);

    expect(result.backend).toBe("aws-secrets-manager");
    expect(result.details).toMatchObject({ mode: "json", secretCount: 1, prunedCount: 0 });
    expect(result.keyCount).toBe(2);
  });

  it("calls TagResource on the update path (PutSecretValue branch)", async () => {
    asmMock.on(PutSecretValueCommand).resolves({});
    asmMock.on(TagResourceCommand).resolves({});

    await build().pack(fakeRequest());

    const tags = asmMock.commandCalls(TagResourceCommand);
    expect(tags).toHaveLength(1);
    expect(tags[0].args[0].input.SecretId).toBe("myapp/dev");
    const tagKeys = (tags[0].args[0].input.Tags ?? []).map((t) => t.Key).sort();
    expect(tagKeys).toEqual(["clef:environment", "clef:identity", "clef:revision"]);
  });

  it("falls back to CreateSecret with inline tags + KmsKeyId on first run", async () => {
    asmMock.on(PutSecretValueCommand).rejects(notFound());
    asmMock.on(CreateSecretCommand).resolves({});

    await build().pack(
      fakeRequest({
        backendOptions: { prefix: "myapp/dev", "kms-key-id": "alias/custom" },
      }),
    );

    const creates = asmMock.commandCalls(CreateSecretCommand);
    expect(creates).toHaveLength(1);
    expect(creates[0].args[0].input.Name).toBe("myapp/dev");
    expect(creates[0].args[0].input.KmsKeyId).toBe("alias/custom");
    const tagKeys = (creates[0].args[0].input.Tags ?? []).map((t) => t.Key).sort();
    expect(tagKeys).toEqual(["clef:environment", "clef:identity", "clef:revision"]);

    // No redundant TagResource call when tags went in via CreateSecret.
    expect(asmMock.commandCalls(TagResourceCommand)).toHaveLength(0);
  });

  it("honors custom tag-prefix", async () => {
    asmMock.on(PutSecretValueCommand).resolves({});
    asmMock.on(TagResourceCommand).resolves({});

    await build().pack(
      fakeRequest({
        backendOptions: { prefix: "myapp/dev", "tag-prefix": "myco-" },
      }),
    );

    const tagCall = asmMock.commandCalls(TagResourceCommand)[0];
    const keys = (tagCall.args[0].input.Tags ?? []).map((t) => t.Key).sort();
    expect(keys).toEqual(["myco-environment", "myco-identity", "myco-revision"]);
  });

  it("rejects payloads exceeding the 64 KiB ASM limit with an actionable hint", async () => {
    const big = "x".repeat(35_000);
    const req = fakeRequest({
      services: {
        encryption: mockEncryption({ A: big, B: big }),
        runner: fakeRunner(),
      },
    });

    await expect(build().pack(req)).rejects.toThrow(/64 KiB.*mode=single/s);
    expect(asmMock.commandCalls(PutSecretValueCommand)).toHaveLength(0);
  });

  it("propagates non-NotFound errors verbatim", async () => {
    asmMock.on(PutSecretValueCommand).rejects(new Error("AccessDeniedException: nope"));

    await expect(build().pack(fakeRequest())).rejects.toThrow(/AccessDenied/);
  });
});

describe("AwsSecretsManagerBackend.pack — single mode", () => {
  function build(): AwsSecretsManagerBackend {
    return new AwsSecretsManagerBackend(() => new SecretsManagerClient({}));
  }

  it("writes one PutSecretValue per key with name = prefix/<key>", async () => {
    asmMock.on(PutSecretValueCommand).resolves({});
    asmMock.on(TagResourceCommand).resolves({});

    const result = await build().pack(
      fakeRequest({ backendOptions: { prefix: "myapp/dev", mode: "single" } }),
    );

    const puts = asmMock.commandCalls(PutSecretValueCommand);
    expect(puts).toHaveLength(2);
    const names = puts.map((c) => c.args[0].input.SecretId).sort();
    expect(names).toEqual(["myapp/dev/API_KEY", "myapp/dev/DB_PASSWORD"]);

    expect(result.details).toMatchObject({ mode: "single", secretCount: 2 });
  });

  it("falls back to CreateSecret per missing key", async () => {
    asmMock.on(PutSecretValueCommand, { SecretId: "myapp/dev/API_KEY" }).rejects(notFound());
    asmMock.on(PutSecretValueCommand, { SecretId: "myapp/dev/DB_PASSWORD" }).resolves({});
    asmMock.on(CreateSecretCommand).resolves({});
    asmMock.on(TagResourceCommand).resolves({});

    await build().pack(fakeRequest({ backendOptions: { prefix: "myapp/dev", mode: "single" } }));

    const creates = asmMock.commandCalls(CreateSecretCommand);
    expect(creates).toHaveLength(1);
    expect(creates[0].args[0].input.Name).toBe("myapp/dev/API_KEY");

    // TagResource is only called for the update branch (DB_PASSWORD), not
    // for the freshly created secret which got tags inline.
    const taggedNames = asmMock
      .commandCalls(TagResourceCommand)
      .map((c) => c.args[0].input.SecretId);
    expect(taggedNames).toEqual(["myapp/dev/DB_PASSWORD"]);
  });

  it("rejects oversized values per key", async () => {
    const oversized = "x".repeat(65_537);
    const req = fakeRequest({
      services: {
        encryption: mockEncryption({ BIG: oversized }),
        runner: fakeRunner(),
      },
      backendOptions: { prefix: "myapp/dev", mode: "single" },
    });

    await expect(build().pack(req)).rejects.toThrow(/'BIG' is 65537 bytes/);
    expect(asmMock.commandCalls(PutSecretValueCommand)).toHaveLength(0);
  });

  it("does not list or delete when prune is unset", async () => {
    asmMock.on(PutSecretValueCommand).resolves({});
    asmMock.on(TagResourceCommand).resolves({});

    const result = await build().pack(
      fakeRequest({ backendOptions: { prefix: "myapp/dev", mode: "single" } }),
    );

    expect(asmMock.commandCalls(ListSecretsCommand)).toHaveLength(0);
    expect(asmMock.commandCalls(DeleteSecretCommand)).toHaveLength(0);
    expect(result.details?.prunedCount).toBe(0);
  });

  it("soft-deletes orphaned secrets when prune=true with default 30d recovery", async () => {
    asmMock.on(PutSecretValueCommand).resolves({});
    asmMock.on(TagResourceCommand).resolves({});
    asmMock.on(ListSecretsCommand).resolves({
      SecretList: [
        { Name: "myapp/dev/STALE_KEY" },
        { Name: "myapp/dev/DB_PASSWORD" },
        { Name: "myapp/dev/ALSO_GONE" },
      ],
    });
    asmMock.on(DeleteSecretCommand).resolves({});

    const result = await build().pack(
      fakeRequest({
        backendOptions: { prefix: "myapp/dev", mode: "single", prune: "true" },
      }),
    );

    const deletes = asmMock.commandCalls(DeleteSecretCommand);
    const deletedNames = deletes.map((c) => c.args[0].input.SecretId).sort();
    expect(deletedNames).toEqual(["myapp/dev/ALSO_GONE", "myapp/dev/STALE_KEY"]);
    for (const c of deletes) {
      expect(c.args[0].input.RecoveryWindowInDays).toBe(30);
    }
    expect(result.details?.prunedCount).toBe(2);
  });

  it("respects recovery-days override", async () => {
    asmMock.on(PutSecretValueCommand).resolves({});
    asmMock.on(TagResourceCommand).resolves({});
    asmMock.on(ListSecretsCommand).resolves({
      SecretList: [{ Name: "myapp/dev/STALE" }],
    });
    asmMock.on(DeleteSecretCommand).resolves({});

    await build().pack(
      fakeRequest({
        backendOptions: {
          prefix: "myapp/dev",
          mode: "single",
          prune: "true",
          "recovery-days": "7",
        },
      }),
    );

    const del = asmMock.commandCalls(DeleteSecretCommand)[0];
    expect(del.args[0].input.RecoveryWindowInDays).toBe(7);
  });

  it("paginates ListSecrets via NextToken", async () => {
    asmMock.on(PutSecretValueCommand).resolves({});
    asmMock.on(TagResourceCommand).resolves({});
    asmMock
      .on(ListSecretsCommand)
      .resolvesOnce({
        SecretList: [{ Name: "myapp/dev/PAGE1_ORPHAN" }],
        NextToken: "tok",
      })
      .resolvesOnce({
        SecretList: [{ Name: "myapp/dev/PAGE2_ORPHAN" }],
      });
    asmMock.on(DeleteSecretCommand).resolves({});

    await build().pack(
      fakeRequest({
        backendOptions: { prefix: "myapp/dev", mode: "single", prune: "true" },
      }),
    );

    expect(asmMock.commandCalls(ListSecretsCommand)).toHaveLength(2);
    expect(asmMock.commandCalls(DeleteSecretCommand)).toHaveLength(2);
  });

  it("skips list entries with no Name during pagination", async () => {
    asmMock.on(PutSecretValueCommand).resolves({});
    asmMock.on(TagResourceCommand).resolves({});
    asmMock.on(ListSecretsCommand).resolves({
      SecretList: [{}, { Name: "myapp/dev/REAL_ORPHAN" }],
    });
    asmMock.on(DeleteSecretCommand).resolves({});

    await build().pack(
      fakeRequest({
        backendOptions: { prefix: "myapp/dev", mode: "single", prune: "true" },
      }),
    );

    expect(asmMock.commandCalls(DeleteSecretCommand)).toHaveLength(1);
  });
});

describe("AwsSecretsManagerBackend.pack — cross-cutting", () => {
  it("reports namespaceCount from the resolved identity", async () => {
    asmMock.on(PutSecretValueCommand).resolves({});
    asmMock.on(TagResourceCommand).resolves({});

    const result = await new AwsSecretsManagerBackend(() => new SecretsManagerClient({})).pack(
      fakeRequest({
        identity: "multi",
        services: {
          encryption: mockEncryption({ X: "1" }),
          runner: fakeRunner(),
        },
      }),
    );

    expect(result.namespaceCount).toBe(2);
  });

  it("forwards the region option to the client factory", async () => {
    asmMock.on(PutSecretValueCommand).resolves({});
    asmMock.on(TagResourceCommand).resolves({});

    const factory = jest.fn().mockReturnValue(new SecretsManagerClient({}));
    const backend = new AwsSecretsManagerBackend(factory);

    await backend.pack(
      fakeRequest({
        backendOptions: { prefix: "myapp/dev", region: "eu-west-1" },
      }),
    );

    expect(factory).toHaveBeenCalledWith("eu-west-1");
  });

  it("uses the default factory when none is supplied (no region)", async () => {
    asmMock.on(PutSecretValueCommand).resolves({});
    asmMock.on(TagResourceCommand).resolves({});
    const backend = new AwsSecretsManagerBackend();
    await expect(backend.pack(fakeRequest())).resolves.toBeDefined();
  });

  it("uses the default factory when none is supplied (with region)", async () => {
    asmMock.on(PutSecretValueCommand).resolves({});
    asmMock.on(TagResourceCommand).resolves({});
    const backend = new AwsSecretsManagerBackend();
    await expect(
      backend.pack(fakeRequest({ backendOptions: { prefix: "myapp/dev", region: "ap-south-1" } })),
    ).resolves.toBeDefined();
  });

  it("treats a generic Error with name=ResourceNotFoundException as a fallback trigger", async () => {
    // Some SDK versions throw a plain ServiceException whose `name` matches
    // even when the constructor isn't ResourceNotFoundException itself.
    const err = new Error("Secret not found");
    err.name = "ResourceNotFoundException";

    asmMock.on(PutSecretValueCommand).rejects(err);
    asmMock.on(CreateSecretCommand).resolves({});

    await new AwsSecretsManagerBackend(() => new SecretsManagerClient({})).pack(fakeRequest());

    expect(asmMock.commandCalls(CreateSecretCommand)).toHaveLength(1);
  });
});
