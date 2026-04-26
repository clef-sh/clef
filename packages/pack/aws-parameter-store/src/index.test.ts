import * as fs from "fs";
import {
  AddTagsToResourceCommand,
  DeleteParameterCommand,
  GetParametersByPathCommand,
  ParameterTier,
  ParameterType,
  PutParameterCommand,
  SSMClient,
} from "@aws-sdk/client-ssm";
import { mockClient } from "aws-sdk-client-mock";
import type {
  ClefManifest,
  DecryptedFile,
  EncryptionBackend,
  PackRequest,
  SubprocessRunner,
} from "@clef-sh/core";

import backendDefault, { AwsParameterStoreBackend } from "./index";

jest.mock("fs");
const mockFs = fs as jest.Mocked<typeof fs>;

const ssmMock = mockClient(SSMClient);

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
    backendOptions: { prefix: "/myapp/dev" },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  ssmMock.reset();
  mockFs.existsSync.mockImplementation((p) => String(p).includes(".enc.yaml"));
});

describe("AwsParameterStoreBackend.validateOptions", () => {
  const backend = new AwsParameterStoreBackend();

  it("rejects missing prefix", () => {
    expect(() => backend.validateOptions({})).toThrow(/requires 'prefix'/);
  });

  it("rejects prefix that does not start with /", () => {
    expect(() => backend.validateOptions({ prefix: "myapp/dev" })).toThrow(/must begin with '\/'/);
  });

  it("rejects unknown tier values", () => {
    expect(() => backend.validateOptions({ prefix: "/x", tier: "Premium" })).toThrow(
      /'Standard' or 'Advanced'/,
    );
  });

  it("accepts a valid options bag", () => {
    expect(() =>
      backend.validateOptions({
        prefix: "/myapp/dev",
        region: "us-east-1",
        "kms-key-id": "alias/custom",
        prune: "true",
        tier: "Advanced",
        "tag-prefix": "myco-",
      }),
    ).not.toThrow();
  });
});

describe("AwsParameterStoreBackend.pack", () => {
  function build(): AwsParameterStoreBackend {
    return new AwsParameterStoreBackend(() => new SSMClient({}));
  }

  it("default export exposes a backend with the expected id", () => {
    expect(backendDefault.id).toBe("aws-parameter-store");
    expect(typeof backendDefault.pack).toBe("function");
  });

  it("writes one SecureString PutParameter per key with default tier and account KMS key", async () => {
    ssmMock.on(PutParameterCommand).resolves({});
    ssmMock.on(AddTagsToResourceCommand).resolves({});

    const result = await build().pack(fakeRequest());

    const puts = ssmMock.commandCalls(PutParameterCommand);
    expect(puts).toHaveLength(2);
    const names = puts.map((c) => c.args[0].input.Name).sort();
    expect(names).toEqual(["/myapp/dev/API_KEY", "/myapp/dev/DB_PASSWORD"]);
    for (const c of puts) {
      expect(c.args[0].input.Type).toBe<ParameterType>("SecureString");
      expect(c.args[0].input.Overwrite).toBe(true);
      expect(c.args[0].input.Tier).toBe(ParameterTier.STANDARD);
      expect(c.args[0].input.KeyId).toBeUndefined();
    }

    expect(result.backend).toBe("aws-parameter-store");
    expect(result.keyCount).toBe(2);
    expect(result.keys.sort()).toEqual(["API_KEY", "DB_PASSWORD"]);
    expect(result.namespaceCount).toBe(1);
    expect(result.outputPath).toBe("");
    expect(result.artifactSize).toBe(0);
    expect(result.revision).toMatch(/^\d+$/);
    expect(result.details).toMatchObject({
      prefix: "/myapp/dev",
      region: null,
      tier: ParameterTier.STANDARD,
      prunedCount: 0,
    });
  });

  it("normalizes a trailing slash in the prefix", async () => {
    ssmMock.on(PutParameterCommand).resolves({});
    ssmMock.on(AddTagsToResourceCommand).resolves({});

    await build().pack(fakeRequest({ backendOptions: { prefix: "/myapp/dev/" } }));

    const names = ssmMock.commandCalls(PutParameterCommand).map((c) => c.args[0].input.Name);
    for (const n of names) {
      expect(n).not.toMatch(/\/\//);
    }
  });

  it("applies the supplied KMS key id when provided", async () => {
    ssmMock.on(PutParameterCommand).resolves({});
    ssmMock.on(AddTagsToResourceCommand).resolves({});

    await build().pack(
      fakeRequest({
        backendOptions: { prefix: "/myapp/dev", "kms-key-id": "alias/custom-key" },
      }),
    );

    const puts = ssmMock.commandCalls(PutParameterCommand);
    for (const c of puts) {
      expect(c.args[0].input.KeyId).toBe("alias/custom-key");
    }
  });

  it("applies tags via AddTagsToResource (not on the Put with Overwrite)", async () => {
    ssmMock.on(PutParameterCommand).resolves({});
    ssmMock.on(AddTagsToResourceCommand).resolves({});

    await build().pack(fakeRequest());

    const tagCalls = ssmMock.commandCalls(AddTagsToResourceCommand);
    expect(tagCalls).toHaveLength(2);
    for (const c of tagCalls) {
      expect(c.args[0].input.ResourceType).toBe("Parameter");
      const tagKeys = (c.args[0].input.Tags ?? []).map((t) => t.Key).sort();
      expect(tagKeys).toEqual(["clef:environment", "clef:identity", "clef:revision"]);
    }
  });

  it("honors a custom tag prefix", async () => {
    ssmMock.on(PutParameterCommand).resolves({});
    ssmMock.on(AddTagsToResourceCommand).resolves({});

    await build().pack(
      fakeRequest({
        backendOptions: { prefix: "/myapp/dev", "tag-prefix": "myco-" },
      }),
    );

    const tagCalls = ssmMock.commandCalls(AddTagsToResourceCommand);
    const keys = (tagCalls[0].args[0].input.Tags ?? []).map((t) => t.Key).sort();
    expect(keys).toEqual(["myco-environment", "myco-identity", "myco-revision"]);
  });

  it("respects the Advanced tier flag", async () => {
    ssmMock.on(PutParameterCommand).resolves({});
    ssmMock.on(AddTagsToResourceCommand).resolves({});

    await build().pack(
      fakeRequest({
        backendOptions: { prefix: "/myapp/dev", tier: "Advanced" },
      }),
    );

    for (const c of ssmMock.commandCalls(PutParameterCommand)) {
      expect(c.args[0].input.Tier).toBe(ParameterTier.ADVANCED);
    }
  });

  it("rejects values exceeding the Standard tier limit with an actionable hint", async () => {
    const oversized = "x".repeat(4097);
    const req = fakeRequest({
      services: {
        encryption: mockEncryption({ BIG: oversized }),
        runner: fakeRunner(),
      },
    });

    await expect(build().pack(req)).rejects.toThrow(/'BIG' is 4097 bytes.*tier=Advanced/s);
    expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(0);
  });

  it("allows oversize values when tier=Advanced", async () => {
    ssmMock.on(PutParameterCommand).resolves({});
    ssmMock.on(AddTagsToResourceCommand).resolves({});

    const oversized = "x".repeat(4097);
    const req = fakeRequest({
      services: {
        encryption: mockEncryption({ BIG: oversized }),
        runner: fakeRunner(),
      },
      backendOptions: { prefix: "/myapp/dev", tier: "Advanced" },
    });

    await expect(build().pack(req)).resolves.toBeDefined();
    expect(ssmMock.commandCalls(PutParameterCommand)).toHaveLength(1);
  });

  it("does not prune by default", async () => {
    ssmMock.on(PutParameterCommand).resolves({});
    ssmMock.on(AddTagsToResourceCommand).resolves({});
    ssmMock.on(GetParametersByPathCommand).resolves({
      Parameters: [{ Name: "/myapp/dev/STALE_KEY" }, { Name: "/myapp/dev/DB_PASSWORD" }],
    });

    const result = await build().pack(fakeRequest());

    expect(ssmMock.commandCalls(GetParametersByPathCommand)).toHaveLength(0);
    expect(ssmMock.commandCalls(DeleteParameterCommand)).toHaveLength(0);
    expect(result.details?.prunedCount).toBe(0);
  });

  it("deletes orphan parameters when prune=true", async () => {
    ssmMock.on(PutParameterCommand).resolves({});
    ssmMock.on(AddTagsToResourceCommand).resolves({});
    ssmMock.on(GetParametersByPathCommand).resolves({
      Parameters: [
        { Name: "/myapp/dev/STALE_KEY" },
        { Name: "/myapp/dev/DB_PASSWORD" },
        { Name: "/myapp/dev/ALSO_GONE" },
      ],
    });
    ssmMock.on(DeleteParameterCommand).resolves({});

    const result = await build().pack(
      fakeRequest({
        backendOptions: { prefix: "/myapp/dev", prune: "true" },
      }),
    );

    const deletes = ssmMock.commandCalls(DeleteParameterCommand);
    const deletedNames = deletes.map((c) => c.args[0].input.Name).sort();
    expect(deletedNames).toEqual(["/myapp/dev/ALSO_GONE", "/myapp/dev/STALE_KEY"]);
    expect(result.details?.prunedCount).toBe(2);
  });

  it("paginates through GetParametersByPath when pruning", async () => {
    ssmMock.on(PutParameterCommand).resolves({});
    ssmMock.on(AddTagsToResourceCommand).resolves({});
    ssmMock
      .on(GetParametersByPathCommand)
      .resolvesOnce({
        Parameters: [{ Name: "/myapp/dev/PAGE1_ORPHAN" }],
        NextToken: "tok",
      })
      .resolvesOnce({
        Parameters: [{ Name: "/myapp/dev/PAGE2_ORPHAN" }],
      });
    ssmMock.on(DeleteParameterCommand).resolves({});

    await build().pack(
      fakeRequest({
        backendOptions: { prefix: "/myapp/dev", prune: "true" },
      }),
    );

    expect(ssmMock.commandCalls(GetParametersByPathCommand)).toHaveLength(2);
    expect(ssmMock.commandCalls(DeleteParameterCommand)).toHaveLength(2);
  });

  it("skips entries with no Name during pagination", async () => {
    ssmMock.on(PutParameterCommand).resolves({});
    ssmMock.on(AddTagsToResourceCommand).resolves({});
    ssmMock.on(GetParametersByPathCommand).resolves({
      Parameters: [{}, { Name: "/myapp/dev/REAL_ORPHAN" }],
    });
    ssmMock.on(DeleteParameterCommand).resolves({});

    await build().pack(
      fakeRequest({
        backendOptions: { prefix: "/myapp/dev", prune: "true" },
      }),
    );

    expect(ssmMock.commandCalls(DeleteParameterCommand)).toHaveLength(1);
  });

  it("reports namespaceCount from the resolved identity", async () => {
    ssmMock.on(PutParameterCommand).resolves({});
    ssmMock.on(AddTagsToResourceCommand).resolves({});

    const result = await build().pack(
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

  it("propagates SSM errors verbatim", async () => {
    ssmMock.on(PutParameterCommand).rejects(new Error("AccessDeniedException: nope"));

    await expect(build().pack(fakeRequest())).rejects.toThrow(/AccessDeniedException/);
  });

  it("forwards the region option when constructing the SSM client", async () => {
    ssmMock.on(PutParameterCommand).resolves({});
    ssmMock.on(AddTagsToResourceCommand).resolves({});

    const factory = jest.fn().mockReturnValue(new SSMClient({}));
    const backend = new AwsParameterStoreBackend(factory);

    await backend.pack(
      fakeRequest({
        backendOptions: { prefix: "/myapp/dev", region: "eu-west-1" },
      }),
    );

    expect(factory).toHaveBeenCalledWith("eu-west-1");
  });

  it("uses the default factory when none is supplied (no region)", async () => {
    ssmMock.on(PutParameterCommand).resolves({});
    ssmMock.on(AddTagsToResourceCommand).resolves({});
    const backend = new AwsParameterStoreBackend();
    await expect(backend.pack(fakeRequest())).resolves.toBeDefined();
  });

  it("uses the default factory when none is supplied (with region)", async () => {
    ssmMock.on(PutParameterCommand).resolves({});
    ssmMock.on(AddTagsToResourceCommand).resolves({});
    const backend = new AwsParameterStoreBackend();
    await expect(
      backend.pack(
        fakeRequest({
          backendOptions: { prefix: "/myapp/dev", region: "ap-south-1" },
        }),
      ),
    ).resolves.toBeDefined();
  });
});
