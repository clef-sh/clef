import { MockSecretSource } from "./mock-source";
import type { ClefManifest } from "../types";

const manifest: ClefManifest = {
  version: 1,
  environments: [
    { name: "dev", description: "" },
    { name: "prod", description: "" },
  ],
  namespaces: [{ name: "api", description: "" }],
  sops: { default_backend: "age" },
  file_pattern: "{namespace}/{environment}.enc.yaml",
};

describe("MockSecretSource — core SecretSource contract", () => {
  it("readCell returns a deep copy so mutations do not bleed into stored state", async () => {
    const source = new MockSecretSource({ cells: { "api/dev": { K: "v" } } });
    const first = await source.readCell({ namespace: "api", environment: "dev" });
    first.values.K = "mutated";
    const second = await source.readCell({ namespace: "api", environment: "dev" });
    expect(second.values.K).toBe("v");
  });

  it("writeCell replaces the cell rather than merging", async () => {
    const source = new MockSecretSource({ cells: { "api/dev": { OLD: "x" } } });
    await source.writeCell({ namespace: "api", environment: "dev" }, { NEW: "y" });
    expect((await source.readCell({ namespace: "api", environment: "dev" })).values).toEqual({
      NEW: "y",
    });
  });

  it("deleteCell clears both values and pending metadata", async () => {
    const source = new MockSecretSource({ cells: { "api/dev": { K: "v" } } });
    await source.markPending({ namespace: "api", environment: "dev" }, ["K"], "alice");
    await source.deleteCell({ namespace: "api", environment: "dev" });
    expect(await source.cellExists({ namespace: "api", environment: "dev" })).toBe(false);
    expect(
      (await source.getPendingMetadata({ namespace: "api", environment: "dev" })).pending,
    ).toEqual([]);
  });

  it("readCell on a missing cell throws", async () => {
    const source = new MockSecretSource();
    await expect(source.readCell({ namespace: "api", environment: "dev" })).rejects.toThrow(
      /Mock cell not found/,
    );
  });

  it("listKeys reflects only what is currently stored", async () => {
    const source = new MockSecretSource({ cells: { "api/dev": { A: "1", B: "2" } } });
    expect(await source.listKeys({ namespace: "api", environment: "dev" })).toEqual(["A", "B"]);
    expect(await source.listKeys({ namespace: "api", environment: "prod" })).toEqual([]);
  });

  it("scaffoldCell is idempotent and does not clobber an existing cell", async () => {
    const source = new MockSecretSource({ cells: { "api/dev": { K: "v" } } });
    await source.scaffoldCell({ namespace: "api", environment: "dev" }, manifest);
    expect((await source.readCell({ namespace: "api", environment: "dev" })).values).toEqual({
      K: "v",
    });
    await source.scaffoldCell({ namespace: "api", environment: "prod" }, manifest);
    expect(await source.cellExists({ namespace: "api", environment: "prod" })).toBe(true);
  });
});

describe("MockSecretSource — pending and rotation metadata", () => {
  const cell = { namespace: "api", environment: "dev" };

  it("markPending is idempotent for the same key", async () => {
    const source = new MockSecretSource({ cells: { "api/dev": {} } });
    await source.markPending(cell, ["K"], "alice");
    await source.markPending(cell, ["K"], "alice");
    expect((await source.getPendingMetadata(cell)).pending).toHaveLength(1);
  });

  it("markResolved clears the pending entry without affecting rotations", async () => {
    const source = new MockSecretSource({ cells: { "api/dev": {} } });
    await source.markPending(cell, ["K"], "alice");
    await source.recordRotation(cell, ["K"], "alice");
    await source.markResolved(cell, ["K"]);
    const meta = await source.getPendingMetadata(cell);
    expect(meta.pending).toEqual([]);
    expect(meta.rotations).toHaveLength(1);
  });

  it("recordRotation increments rotationCount on subsequent rotations of the same key", async () => {
    const source = new MockSecretSource({ cells: { "api/dev": {} } });
    await source.recordRotation(cell, ["K"], "alice");
    await source.recordRotation(cell, ["K"], "bob");
    const meta = await source.getPendingMetadata(cell);
    expect(meta.rotations).toHaveLength(1);
    expect(meta.rotations[0].rotationCount).toBe(2);
    expect(meta.rotations[0].rotatedBy).toBe("bob");
  });

  it("removeRotation drops only the specified keys", async () => {
    const source = new MockSecretSource({ cells: { "api/dev": {} } });
    await source.recordRotation(cell, ["A", "B"], "alice");
    await source.removeRotation(cell, ["A"]);
    const meta = await source.getPendingMetadata(cell);
    expect(meta.rotations.map((r) => r.key)).toEqual(["B"]);
  });
});

describe("MockSecretSource — capability toggles", () => {
  it("does not expose validateEncryption when lint is disabled", () => {
    const source = new MockSecretSource({ capabilities: { lint: false } }) as unknown as {
      validateEncryption?: unknown;
    };
    expect(source.validateEncryption).toBeUndefined();
  });

  it("does not expose merge methods when merge is disabled", () => {
    const source = new MockSecretSource({ capabilities: { merge: false } }) as unknown as {
      mergeCells?: unknown;
      installMergeDriver?: unknown;
    };
    expect(source.mergeCells).toBeUndefined();
    expect(source.installMergeDriver).toBeUndefined();
  });

  it("does not expose structural methods when structural is disabled", () => {
    const source = new MockSecretSource({ capabilities: { structural: false } }) as unknown as {
      addNamespace?: unknown;
      renameEnvironment?: unknown;
    };
    expect(source.addNamespace).toBeUndefined();
    expect(source.renameEnvironment).toBeUndefined();
  });
});

describe("MockSecretSource — Structural in-memory behavior", () => {
  it("removeNamespace deletes every cell under the namespace", async () => {
    const source = new MockSecretSource({
      cells: { "api/dev": { K: "1" }, "api/prod": { K: "2" }, "other/dev": { K: "3" } },
    });
    await source.removeNamespace("api", manifest);
    expect(await source.cellExists({ namespace: "api", environment: "dev" })).toBe(false);
    expect(await source.cellExists({ namespace: "api", environment: "prod" })).toBe(false);
    expect(await source.cellExists({ namespace: "other", environment: "dev" })).toBe(true);
  });

  it("renameNamespace moves every cell to the new namespace name", async () => {
    const source = new MockSecretSource({
      cells: { "api/dev": { K: "1" }, "api/prod": { K: "2" } },
    });
    await source.renameNamespace("api", "billing", manifest);
    expect((await source.readCell({ namespace: "billing", environment: "dev" })).values).toEqual({
      K: "1",
    });
    expect(await source.cellExists({ namespace: "api", environment: "dev" })).toBe(false);
  });

  it("renameEnvironment moves every cell to the new environment name", async () => {
    const source = new MockSecretSource({
      cells: { "api/dev": { K: "1" }, "billing/dev": { K: "2" } },
    });
    await source.renameEnvironment("dev", "development", manifest);
    expect(
      (await source.readCell({ namespace: "api", environment: "development" })).values,
    ).toEqual({ K: "1" });
    expect(await source.cellExists({ namespace: "api", environment: "dev" })).toBe(false);
  });
});
