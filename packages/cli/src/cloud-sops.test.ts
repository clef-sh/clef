import { createCloudAwareSopsClient } from "./cloud-sops";
import type { ClefManifest } from "@clef-sh/core";

const mockCreateCloudSopsClient = jest.fn();

jest.mock("@clef-sh/cloud", () => ({
  createCloudSopsClient: mockCreateCloudSopsClient,
}));

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
    mockCreateCloudSopsClient.mockResolvedValue({
      client: { decrypt: jest.fn(), encrypt: jest.fn() },
      cleanup: jest.fn().mockResolvedValue(undefined),
    });
  });

  it("should return standard client for non-cloud manifest", async () => {
    const { client, cleanup } = await createCloudAwareSopsClient("/repo", runner, ageManifest());

    expect(client).toBeDefined();
    expect(mockCreateCloudSopsClient).not.toHaveBeenCalled();
    await cleanup(); // no-op
  });

  it("should delegate to @clef-sh/cloud for cloud manifest", async () => {
    const { client } = await createCloudAwareSopsClient("/repo", runner, cloudManifest());

    expect(client).toBeDefined();
    expect(mockCreateCloudSopsClient).toHaveBeenCalledWith(
      "/repo",
      runner,
      expect.any(Function), // createSopsClient from age-credential
    );
  });

  it("should propagate errors from @clef-sh/cloud", async () => {
    mockCreateCloudSopsClient.mockRejectedValue(
      new Error("Cloud token required. Set CLEF_CLOUD_TOKEN or run 'clef cloud login'."),
    );

    await expect(createCloudAwareSopsClient("/repo", runner, cloudManifest())).rejects.toThrow(
      "Cloud token required",
    );
  });
});
