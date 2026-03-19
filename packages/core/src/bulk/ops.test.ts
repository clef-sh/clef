import { BulkOps } from "./ops";
import { ClefManifest, MatrixCell } from "../types";
import { SopsClient } from "../sops/client";

function testManifest(): ClefManifest {
  return {
    version: 1,
    environments: [
      { name: "dev", description: "Development" },
      { name: "staging", description: "Staging" },
      { name: "production", description: "Production" },
    ],
    namespaces: [{ name: "database", description: "DB" }],
    sops: { default_backend: "age" },
    file_pattern: "{namespace}/{environment}.enc.yaml",
  };
}

function mockSopsClient(existingValues: Record<string, Record<string, string>>): SopsClient {
  const encrypted: Record<string, Record<string, string>> = {};
  for (const [k, v] of Object.entries(existingValues)) {
    encrypted[k] = { ...v };
  }

  return {
    decrypt: jest.fn().mockImplementation(async (filePath: string) => {
      const env = Object.keys(existingValues).find((e) => filePath.includes(e));
      const values = env ? { ...encrypted[env] } : {};
      return {
        values,
        metadata: {
          backend: "age" as const,
          recipients: ["age1test"],
          lastModified: new Date(),
        },
      };
    }),
    encrypt: jest
      .fn()
      .mockImplementation(async (filePath: string, values: Record<string, string>) => {
        const env = Object.keys(existingValues).find((e) => filePath.includes(e));
        if (env) {
          encrypted[env] = { ...values };
        }
      }),
  } as unknown as SopsClient;
}

describe("BulkOps", () => {
  let ops: BulkOps;

  beforeEach(() => {
    ops = new BulkOps();
  });

  describe("setAcrossEnvironments", () => {
    it("should set a key in all specified environments", async () => {
      const client = mockSopsClient({
        dev: { EXISTING: "val" },
        staging: { EXISTING: "val" },
        production: { EXISTING: "val" },
      });

      await ops.setAcrossEnvironments(
        "database",
        "NEW_KEY",
        { dev: "dev-val", staging: "staging-val", production: "prod-val" },
        testManifest(),
        client,
        "/repo",
      );

      expect(client.decrypt).toHaveBeenCalledTimes(3);
      expect(client.encrypt).toHaveBeenCalledTimes(3);

      // Verify values were passed correctly
      const encryptCalls = (client.encrypt as jest.Mock).mock.calls;
      for (const call of encryptCalls) {
        expect(call[1]).toHaveProperty("NEW_KEY");
        expect(call[1]).toHaveProperty("EXISTING", "val");
      }
    });

    it("should skip environments not in the values map", async () => {
      const client = mockSopsClient({
        dev: { KEY: "val" },
        staging: { KEY: "val" },
        production: { KEY: "val" },
      });

      await ops.setAcrossEnvironments(
        "database",
        "NEW",
        { dev: "only-dev" },
        testManifest(),
        client,
        "/repo",
      );

      expect(client.decrypt).toHaveBeenCalledTimes(1);
      expect(client.encrypt).toHaveBeenCalledTimes(1);
    });

    it("should throw with details when some environments fail", async () => {
      const client = {
        decrypt: jest.fn().mockImplementation(async (filePath: string) => {
          if (filePath.includes("production")) {
            throw new Error("Access denied");
          }
          return {
            values: {},
            metadata: {
              backend: "age" as const,
              recipients: ["age1test"],
              lastModified: new Date(),
            },
          };
        }),
        encrypt: jest.fn().mockResolvedValue(undefined),
      } as unknown as SopsClient;

      await expect(
        ops.setAcrossEnvironments(
          "database",
          "KEY",
          { dev: "v1", production: "v2" },
          testManifest(),
          client,
          "/repo",
        ),
      ).rejects.toThrow(/Failed to set key.*1 environment/);
    });
  });

  describe("deleteAcrossEnvironments", () => {
    it("should delete a key from all environments", async () => {
      const client = mockSopsClient({
        dev: { KEY_TO_DELETE: "val", KEEP: "keep" },
        staging: { KEY_TO_DELETE: "val", KEEP: "keep" },
        production: { KEY_TO_DELETE: "val", KEEP: "keep" },
      });

      await ops.deleteAcrossEnvironments(
        "database",
        "KEY_TO_DELETE",
        testManifest(),
        client,
        "/repo",
      );

      expect(client.encrypt).toHaveBeenCalledTimes(3);
      const encryptCalls = (client.encrypt as jest.Mock).mock.calls;
      for (const call of encryptCalls) {
        expect(call[1]).not.toHaveProperty("KEY_TO_DELETE");
        expect(call[1]).toHaveProperty("KEEP", "keep");
      }
    });

    it("should skip environments where the key does not exist", async () => {
      const client = mockSopsClient({
        dev: { KEY: "val" },
        staging: {},
        production: { KEY: "val" },
      });

      await ops.deleteAcrossEnvironments("database", "KEY", testManifest(), client, "/repo");

      // Staging had no key, so encrypt should be called only for dev + production
      expect(client.encrypt).toHaveBeenCalledTimes(2);
    });

    it("should throw with details when some environments fail", async () => {
      const client = {
        decrypt: jest.fn().mockRejectedValue(new Error("Decrypt failed")),
        encrypt: jest.fn(),
      } as unknown as SopsClient;

      await expect(
        ops.deleteAcrossEnvironments("database", "KEY", testManifest(), client, "/repo"),
      ).rejects.toThrow(/Failed to delete key.*3 environment/);
    });
  });

  describe("copyValue", () => {
    it("should copy a key value from one cell to another", async () => {
      const client = {
        decrypt: jest.fn().mockImplementation(async (filePath: string) => {
          if (filePath === "/repo/database/dev.enc.yaml") {
            return {
              values: { SECRET: "secret-value", OTHER: "other" },
              metadata: {
                backend: "age" as const,
                recipients: ["age1test"],
                lastModified: new Date(),
              },
            };
          }
          return {
            values: { EXISTING: "keep" },
            metadata: {
              backend: "age" as const,
              recipients: ["age1test"],
              lastModified: new Date(),
            },
          };
        }),
        encrypt: jest.fn().mockResolvedValue(undefined),
      } as unknown as SopsClient;

      const from: MatrixCell = {
        namespace: "database",
        environment: "dev",
        filePath: "/repo/database/dev.enc.yaml",
        exists: true,
      };
      const to: MatrixCell = {
        namespace: "database",
        environment: "staging",
        filePath: "/repo/database/staging.enc.yaml",
        exists: true,
      };

      await ops.copyValue("SECRET", from, to, client, testManifest());

      expect(client.encrypt).toHaveBeenCalledWith(
        "/repo/database/staging.enc.yaml",
        { EXISTING: "keep", SECRET: "secret-value" },
        expect.any(Object),
        "staging",
      );
    });

    it("should throw when key does not exist in source", async () => {
      const client = {
        decrypt: jest.fn().mockResolvedValue({
          values: {},
          metadata: {
            backend: "age" as const,
            recipients: ["age1test"],
            lastModified: new Date(),
          },
        }),
      } as unknown as SopsClient;

      const from: MatrixCell = {
        namespace: "database",
        environment: "dev",
        filePath: "/repo/database/dev.enc.yaml",
        exists: true,
      };
      const to: MatrixCell = {
        namespace: "database",
        environment: "staging",
        filePath: "/repo/database/staging.enc.yaml",
        exists: true,
      };

      await expect(ops.copyValue("MISSING", from, to, client, testManifest())).rejects.toThrow(
        /does not exist/,
      );
    });
  });
});
