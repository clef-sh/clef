import { defaultBulk } from "./default-bulk";
import { MockSecretSource } from "./mock-source";
import type { ClefManifest } from "../types";

const manifest: ClefManifest = {
  version: 1,
  environments: [
    { name: "dev", description: "" },
    { name: "staging", description: "" },
    { name: "prod", description: "" },
  ],
  namespaces: [{ name: "api", description: "" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
};

describe("defaultBulk", () => {
  describe("bulkSet", () => {
    it("writes the new key into every supplied environment, preserving siblings", async () => {
      const source = new MockSecretSource({
        cells: {
          "api/dev": { EXISTING: "x" },
          "api/staging": { EXISTING: "y" },
        },
      });
      await defaultBulk(source).bulkSet("api", "API_KEY", { dev: "d", staging: "s" }, manifest);
      expect((await source.readCell({ namespace: "api", environment: "dev" })).values).toEqual({
        EXISTING: "x",
        API_KEY: "d",
      });
      expect((await source.readCell({ namespace: "api", environment: "staging" })).values).toEqual({
        EXISTING: "y",
        API_KEY: "s",
      });
    });

    it("creates a fresh cell when the target environment does not exist", async () => {
      const source = new MockSecretSource();
      await defaultBulk(source).bulkSet("api", "K", { dev: "v" }, manifest);
      expect(await source.cellExists({ namespace: "api", environment: "dev" })).toBe(true);
      expect((await source.readCell({ namespace: "api", environment: "dev" })).values).toEqual({
        K: "v",
      });
    });
  });

  describe("bulkDelete", () => {
    it("removes the key from every environment that has it", async () => {
      const source = new MockSecretSource({
        cells: {
          "api/dev": { K: "1", OTHER: "x" },
          "api/staging": { K: "2" },
          "api/prod": { OTHER: "y" }, // K missing
        },
      });
      await defaultBulk(source).bulkDelete("api", "K", manifest);
      expect((await source.readCell({ namespace: "api", environment: "dev" })).values).toEqual({
        OTHER: "x",
      });
      expect((await source.readCell({ namespace: "api", environment: "staging" })).values).toEqual(
        {},
      );
      expect((await source.readCell({ namespace: "api", environment: "prod" })).values).toEqual({
        OTHER: "y",
      });
    });

    it("is a no-op for cells that do not exist", async () => {
      const source = new MockSecretSource({ cells: { "api/dev": { K: "v" } } });
      await defaultBulk(source).bulkDelete("api", "K", manifest); // staging+prod absent
      expect((await source.readCell({ namespace: "api", environment: "dev" })).values).toEqual({});
    });
  });

  describe("copyValue", () => {
    it("copies a single key without overwriting unrelated destination keys", async () => {
      const source = new MockSecretSource({
        cells: {
          "api/dev": { K: "from-dev", OTHER: "x" },
          "api/staging": { OTHER: "y" },
        },
      });
      await defaultBulk(source).copyValue(
        "K",
        { namespace: "api", environment: "dev" },
        { namespace: "api", environment: "staging" },
        manifest,
      );
      expect((await source.readCell({ namespace: "api", environment: "staging" })).values).toEqual({
        OTHER: "y",
        K: "from-dev",
      });
    });

    it("throws when the source cell does not contain the key", async () => {
      const source = new MockSecretSource({ cells: { "api/dev": { OTHER: "x" } } });
      await expect(
        defaultBulk(source).copyValue(
          "K",
          { namespace: "api", environment: "dev" },
          { namespace: "api", environment: "staging" },
          manifest,
        ),
      ).rejects.toThrow(/key 'K' not present/);
    });
  });
});
