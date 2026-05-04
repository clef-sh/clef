import * as YAML from "yaml";
import { composeSecretSource } from "./compose";
import type { BlobStore } from "./blob-store";
import { SopsClient } from "../sops/client";
import {
  isBulk,
  isLintable,
  isMergeAware,
  isMigratable,
  isRecipientManaged,
  isRotatable,
  isStructural,
} from "./guards";
import type { ClefManifest } from "../types";
import type { CellPendingMetadata, CellRef } from "./types";

jest.mock("../dependencies/checker", () => ({
  assertSops: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../sops/resolver", () => ({
  resolveSopsPath: jest.fn().mockReturnValue({ path: "sops", source: "system" }),
}));

const manifest: ClefManifest = {
  version: 1,
  environments: [
    { name: "dev", description: "" },
    { name: "prod", description: "" },
  ],
  namespaces: [{ name: "api", description: "" }],
  sops: { default_backend: "age", age: { recipients: ["age1abc"] } },
  file_pattern: "{namespace}/{environment}.enc.yaml",
};

function makeBlobStore(initial: Record<string, string> = {}): jest.Mocked<BlobStore> {
  const blobs = new Map<string, string>(Object.entries(initial));
  const pending = new Map<string, CellPendingMetadata>();
  const key = (c: CellRef): string => `${c.namespace}/${c.environment}`;
  return {
    id: "mock-substrate",
    description: "in-memory",
    readBlob: jest.fn(async (c: CellRef) => {
      const v = blobs.get(key(c));
      if (v === undefined) throw new Error(`missing ${key(c)}`);
      return v;
    }),
    writeBlob: jest.fn(async (c: CellRef, b: string) => {
      blobs.set(key(c), b);
    }),
    deleteBlob: jest.fn(async (c: CellRef) => {
      blobs.delete(key(c));
      pending.delete(key(c));
    }),
    blobExists: jest.fn(async (c: CellRef) => blobs.has(key(c))),
    blobFormat: jest.fn(() => "yaml"),
    readPendingMetadata: jest.fn(
      async (c: CellRef) => pending.get(key(c)) ?? { version: 1, pending: [], rotations: [] },
    ),
    writePendingMetadata: jest.fn(async (c: CellRef, m: CellPendingMetadata) => {
      pending.set(key(c), m);
    }),
  } as unknown as jest.Mocked<BlobStore>;
}

function makeSopsStub(): jest.Mocked<SopsClient> {
  return {
    decryptBlob: jest.fn(async () => ({
      values: { K: "v" },
      metadata: {
        backend: "age",
        recipients: ["age1abc"],
        lastModified: new Date(0),
        lastModifiedPresent: false,
      },
    })),
    encryptBlob: jest.fn(async () => "encrypted-bytes"),
    rotateBlob: jest.fn(async () => "rotated-bytes"),
    getMetadataFromBlob: jest.fn(() => ({
      backend: "age",
      recipients: ["age1abc"],
      lastModified: new Date(0),
      lastModifiedPresent: false,
    })),
    validateEncryptionBlob: jest.fn(() => true),
  } as unknown as jest.Mocked<SopsClient>;
}

describe("composeSecretSource — core SecretSource", () => {
  it("readCell goes through blobStore.readBlob then sopsClient.decryptBlob", async () => {
    const store = makeBlobStore({ "api/dev": "ciphertext" });
    const sops = makeSopsStub();
    const source = composeSecretSource(store, sops, manifest);

    const data = await source.readCell({ namespace: "api", environment: "dev" });

    expect(store.readBlob).toHaveBeenCalledWith({ namespace: "api", environment: "dev" });
    expect(sops.decryptBlob).toHaveBeenCalledWith("ciphertext", "yaml");
    expect(data.values).toEqual({ K: "v" });
  });

  it("writeCell goes through sopsClient.encryptBlob then blobStore.writeBlob", async () => {
    const store = makeBlobStore();
    const sops = makeSopsStub();
    const source = composeSecretSource(store, sops, manifest);

    await source.writeCell({ namespace: "api", environment: "dev" }, { K: "v" });

    expect(sops.encryptBlob).toHaveBeenCalledWith({ K: "v" }, manifest, "dev", "yaml");
    expect(store.writeBlob).toHaveBeenCalledWith(
      { namespace: "api", environment: "dev" },
      "encrypted-bytes",
    );
  });

  it("deleteCell delegates to blobStore.deleteBlob", async () => {
    const store = makeBlobStore({ "api/dev": "ciphertext" });
    const source = composeSecretSource(store, makeSopsStub(), manifest);

    await source.deleteCell({ namespace: "api", environment: "dev" });
    expect(store.deleteBlob).toHaveBeenCalled();
  });

  it("cellExists delegates to blobStore.blobExists", async () => {
    const store = makeBlobStore({ "api/dev": "x" });
    const source = composeSecretSource(store, makeSopsStub(), manifest);

    expect(await source.cellExists({ namespace: "api", environment: "dev" })).toBe(true);
    expect(await source.cellExists({ namespace: "api", environment: "prod" })).toBe(false);
  });

  it("listKeys parses the SOPS YAML and excludes the sops metadata block", async () => {
    const blob = YAML.stringify({
      DATABASE_URL: "ENC[...]",
      API_KEY: "ENC[...]",
      sops: { age: [], lastmodified: "2026-01-01T00:00:00Z" },
    });
    const store = makeBlobStore({ "api/dev": blob });
    const source = composeSecretSource(store, makeSopsStub(), manifest);

    const keys = await source.listKeys({ namespace: "api", environment: "dev" });
    expect(keys).toEqual(["DATABASE_URL", "API_KEY"]);
  });

  it("listKeys returns empty array for a non-existent cell (no decrypt attempted)", async () => {
    const store = makeBlobStore();
    const sops = makeSopsStub();
    const source = composeSecretSource(store, sops, manifest);

    expect(await source.listKeys({ namespace: "api", environment: "dev" })).toEqual([]);
    expect(sops.decryptBlob).not.toHaveBeenCalled();
  });

  it("getCellMetadata reads the blob and uses sopsClient.getMetadataFromBlob (no decrypt)", async () => {
    const store = makeBlobStore({ "api/dev": "ciphertext" });
    const sops = makeSopsStub();
    const source = composeSecretSource(store, sops, manifest);

    await source.getCellMetadata({ namespace: "api", environment: "dev" });

    expect(sops.getMetadataFromBlob).toHaveBeenCalledWith("ciphertext");
    expect(sops.decryptBlob).not.toHaveBeenCalled();
  });

  it("scaffoldCell is a no-op for an existing cell", async () => {
    const store = makeBlobStore({ "api/dev": "x" });
    const sops = makeSopsStub();
    const source = composeSecretSource(store, sops, manifest);

    await source.scaffoldCell({ namespace: "api", environment: "dev" }, manifest);
    expect(sops.encryptBlob).not.toHaveBeenCalled();
    expect(store.writeBlob).not.toHaveBeenCalled();
  });

  it("scaffoldCell creates an empty-values blob for a missing cell", async () => {
    const store = makeBlobStore();
    const sops = makeSopsStub();
    const source = composeSecretSource(store, sops, manifest);

    await source.scaffoldCell({ namespace: "api", environment: "dev" }, manifest);
    expect(sops.encryptBlob).toHaveBeenCalledWith({}, manifest, "dev", "yaml");
    expect(store.writeBlob).toHaveBeenCalled();
  });
});

describe("composeSecretSource — pending metadata", () => {
  const cell = { namespace: "api", environment: "dev" };

  it("markPending appends a fresh pending entry", async () => {
    const store = makeBlobStore({ "api/dev": "x" });
    const source = composeSecretSource(store, makeSopsStub(), manifest);

    await source.markPending(cell, ["DB_URL"], "alice");
    const meta = await source.getPendingMetadata(cell);
    expect(meta.pending).toHaveLength(1);
    expect(meta.pending[0].key).toBe("DB_URL");
    expect(meta.pending[0].setBy).toBe("alice");
  });

  it("markPending is idempotent on the same key", async () => {
    const store = makeBlobStore({ "api/dev": "x" });
    const source = composeSecretSource(store, makeSopsStub(), manifest);
    await source.markPending(cell, ["K"], "alice");
    await source.markPending(cell, ["K"], "alice");
    const meta = await source.getPendingMetadata(cell);
    expect(meta.pending).toHaveLength(1);
  });

  it("markResolved removes only the specified keys", async () => {
    const store = makeBlobStore({ "api/dev": "x" });
    const source = composeSecretSource(store, makeSopsStub(), manifest);
    await source.markPending(cell, ["A", "B"], "alice");
    await source.markResolved(cell, ["A"]);
    const meta = await source.getPendingMetadata(cell);
    expect(meta.pending.map((p) => p.key)).toEqual(["B"]);
  });

  it("recordRotation increments rotationCount on subsequent rotations of the same key", async () => {
    const store = makeBlobStore({ "api/dev": "x" });
    const source = composeSecretSource(store, makeSopsStub(), manifest);
    await source.recordRotation(cell, ["K"], "alice");
    await source.recordRotation(cell, ["K"], "bob");
    const meta = await source.getPendingMetadata(cell);
    expect(meta.rotations).toHaveLength(1);
    expect(meta.rotations[0].rotationCount).toBe(2);
    expect(meta.rotations[0].rotatedBy).toBe("bob");
  });

  it("removeRotation drops only the specified keys", async () => {
    const store = makeBlobStore({ "api/dev": "x" });
    const source = composeSecretSource(store, makeSopsStub(), manifest);
    await source.recordRotation(cell, ["A", "B"], "alice");
    await source.removeRotation(cell, ["A"]);
    const meta = await source.getPendingMetadata(cell);
    expect(meta.rotations.map((r) => r.key)).toEqual(["B"]);
  });
});

describe("composeSecretSource — Lintable trait", () => {
  it("validateEncryption returns false for missing cells (no IO past blobExists)", async () => {
    const store = makeBlobStore();
    const sops = makeSopsStub();
    const source = composeSecretSource(store, sops, manifest);

    expect(await source.validateEncryption({ namespace: "api", environment: "dev" })).toBe(false);
    expect(sops.validateEncryptionBlob).not.toHaveBeenCalled();
  });

  it("validateEncryption delegates to sopsClient.validateEncryptionBlob for existing cells", async () => {
    const store = makeBlobStore({ "api/dev": "ciphertext" });
    const sops = makeSopsStub();
    const source = composeSecretSource(store, sops, manifest);

    expect(await source.validateEncryption({ namespace: "api", environment: "dev" })).toBe(true);
    expect(sops.validateEncryptionBlob).toHaveBeenCalledWith("ciphertext");
  });

  it("checkRecipientDrift surfaces missing and unexpected recipients", async () => {
    const store = makeBlobStore({ "api/dev": "ciphertext" });
    const sops = makeSopsStub();
    sops.getMetadataFromBlob.mockReturnValue({
      backend: "age",
      recipients: ["age1abc", "age1unexpected"],
      lastModified: new Date(0),
      lastModifiedPresent: false,
    });
    const source = composeSecretSource(store, sops, manifest);

    const drift = await source.checkRecipientDrift({ namespace: "api", environment: "dev" }, [
      "age1abc",
      "age1missing",
    ]);
    expect(drift.missing).toEqual(["age1missing"]);
    expect(drift.unexpected).toEqual(["age1unexpected"]);
  });
});

describe("composeSecretSource — Rotatable trait", () => {
  it("rotate goes through readBlob, rotateBlob with addAge, then writeBlob", async () => {
    const store = makeBlobStore({ "api/dev": "ciphertext" });
    const sops = makeSopsStub();
    const source = composeSecretSource(store, sops, manifest);

    await source.rotate({ namespace: "api", environment: "dev" }, "age1new");

    expect(sops.rotateBlob).toHaveBeenCalledWith("ciphertext", { addAge: "age1new" }, "yaml");
    expect(store.writeBlob).toHaveBeenCalledWith(
      { namespace: "api", environment: "dev" },
      "rotated-bytes",
    );
  });
});

describe("composeSecretSource — Bulk trait", () => {
  it("copyValue copies a single key from one cell to another via core methods", async () => {
    const store = makeBlobStore({ "api/dev": "x", "api/prod": "y" });
    const sops = makeSopsStub();
    sops.decryptBlob.mockImplementation(async () => ({
      values: { K: "from-dev", OTHER: "x" },
      metadata: {
        backend: "age",
        recipients: ["age1abc"],
        lastModified: new Date(0),
        lastModifiedPresent: false,
      },
    }));
    const source = composeSecretSource(store, sops, manifest);

    await source.copyValue(
      "K",
      { namespace: "api", environment: "dev" },
      { namespace: "api", environment: "prod" },
      manifest,
    );

    expect(sops.encryptBlob).toHaveBeenCalled();
  });
});

describe("composeSecretSource — capability surface", () => {
  it("composed source reports lint/rotate/bulk capabilities", () => {
    const source = composeSecretSource(makeBlobStore(), makeSopsStub(), manifest);
    expect(isLintable(source)).toBe(true);
    expect(isRotatable(source)).toBe(true);
    expect(isBulk(source)).toBe(true);
  });

  it("composed source does NOT yet report recipients/merge/migrate/structural (deferred to later phases)", () => {
    const source = composeSecretSource(makeBlobStore(), makeSopsStub(), manifest);
    expect(isRecipientManaged(source)).toBe(false);
    expect(isMergeAware(source)).toBe(false);
    expect(isMigratable(source)).toBe(false);
    expect(isStructural(source)).toBe(false);
  });

  it("source.id and description come from the underlying BlobStore", () => {
    const source = composeSecretSource(makeBlobStore(), makeSopsStub(), manifest);
    expect(source.id).toBe("mock-substrate");
    expect(source.description).toBe("in-memory");
  });
});
