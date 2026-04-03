import { createCloudAwareSopsClient } from "./cloud-sops";
import type { ClefManifest } from "@clef-sh/core";

jest.mock("@clef-sh/core", () => {
  const actual = jest.requireActual("@clef-sh/core");
  return {
    ...actual,
    readCloudCredentials: jest.fn().mockReturnValue(null),
    resolveKeyservicePath: jest
      .fn()
      .mockReturnValue({ path: "/bin/clef-keyservice", source: "bundled" }),
    spawnKeyservice: jest.fn().mockResolvedValue({
      addr: "tcp://127.0.0.1:9999",
      kill: jest.fn().mockResolvedValue(undefined),
    }),
  };
});

jest.mock("./age-credential", () => ({
  createSopsClient: jest.fn().mockResolvedValue({ decrypt: jest.fn(), encrypt: jest.fn() }),
}));

function ageManifest(): ClefManifest {
  return {
    version: 1,
    environments: [{ name: "dev", description: "Dev" }],
    namespaces: [{ name: "api", description: "API" }],
    sops: { default_backend: "age" },
    file_pattern: "{namespace}/{environment}.enc.yaml",
  };
}

function cloudManifest(): ClefManifest {
  return {
    version: 1,
    environments: [
      { name: "dev", description: "Dev" },
      { name: "production", description: "Prod", sops: { backend: "cloud" } },
    ],
    namespaces: [{ name: "api", description: "API" }],
    sops: { default_backend: "age" },
    file_pattern: "{namespace}/{environment}.enc.yaml",
    cloud: { integrationId: "int_abc", keyId: "clef:int_abc/production" },
  };
}

describe("createCloudAwareSopsClient", () => {
  const runner = { run: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CLEF_CLOUD_TOKEN;
    const core = jest.requireMock("@clef-sh/core");
    core.readCloudCredentials.mockReturnValue(null);
  });

  it("should return standard client for non-cloud manifest", async () => {
    const { client, cleanup } = await createCloudAwareSopsClient("/repo", runner, ageManifest());

    expect(client).toBeDefined();
    const core = jest.requireMock("@clef-sh/core");
    expect(core.spawnKeyservice).not.toHaveBeenCalled();
    await cleanup(); // no-op
  });

  it("should spawn keyservice for cloud manifest with env token", async () => {
    process.env.CLEF_CLOUD_TOKEN = "test_token";

    const { client, cleanup } = await createCloudAwareSopsClient("/repo", runner, cloudManifest());

    expect(client).toBeDefined();
    const core = jest.requireMock("@clef-sh/core");
    expect(core.spawnKeyservice).toHaveBeenCalledWith(
      expect.objectContaining({ token: "test_token" }),
    );
    await cleanup();
  });

  it("should spawn keyservice for cloud manifest with credentials file", async () => {
    const core = jest.requireMock("@clef-sh/core");
    core.readCloudCredentials.mockReturnValue({
      token: "cred_token",
      endpoint: "https://custom.api",
    });

    const { cleanup } = await createCloudAwareSopsClient("/repo", runner, cloudManifest());

    expect(core.spawnKeyservice).toHaveBeenCalledWith(
      expect.objectContaining({ token: "cred_token", endpoint: "https://custom.api" }),
    );
    await cleanup();
  });

  it("should throw when cloud backend but no token available", async () => {
    await expect(createCloudAwareSopsClient("/repo", runner, cloudManifest())).rejects.toThrow(
      "Cloud token required",
    );
  });

  it("should prefer CLEF_CLOUD_TOKEN over credentials file", async () => {
    process.env.CLEF_CLOUD_TOKEN = "env_token";
    const core = jest.requireMock("@clef-sh/core");
    core.readCloudCredentials.mockReturnValue({ token: "file_token" });

    await createCloudAwareSopsClient("/repo", runner, cloudManifest());

    expect(core.spawnKeyservice).toHaveBeenCalledWith(
      expect.objectContaining({ token: "env_token" }),
    );
  });
});
