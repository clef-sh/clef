import * as YAML from "yaml";
import { composeSecretSource } from "./compose";
import type { StorageBackend } from "./storage-backend";
import type { EncryptionBackend } from "./encryption-backend";
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

function makeStorageBackend(initial: Record<string, string> = {}): jest.Mocked<StorageBackend> {
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
  } as unknown as jest.Mocked<StorageBackend>;
}

function makeEncryption(): jest.Mocked<EncryptionBackend> {
  return {
    id: "mock-encryption",
    description: "in-memory mock encryption",
    decrypt: jest.fn(async () => ({
      values: { K: "v" },
      metadata: {
        backend: "age",
        recipients: ["age1abc"],
        lastModified: new Date(0),
        lastModifiedPresent: false,
      },
    })),
    encrypt: jest.fn(async () => "encrypted-bytes"),
    rotate: jest.fn(async () => "rotated-bytes"),
    getMetadata: jest.fn(() => ({
      backend: "age",
      recipients: ["age1abc"],
      lastModified: new Date(0),
      lastModifiedPresent: false,
    })),
    validateEncryption: jest.fn(() => true),
  } as unknown as jest.Mocked<EncryptionBackend>;
}

describe("composeSecretSource — core SecretSource", () => {
  it("readCell goes through blobStore.readBlob then sopsClient.decryptBlob", async () => {
    const store = makeStorageBackend({ "api/dev": "ciphertext" });
    const enc = makeEncryption();
    const source = composeSecretSource(store, enc, manifest);

    const data = await source.readCell({ namespace: "api", environment: "dev" });

    expect(store.readBlob).toHaveBeenCalledWith({ namespace: "api", environment: "dev" });
    expect(enc.decrypt).toHaveBeenCalledWith(
      "ciphertext",
      expect.objectContaining({
        manifest,
        environment: "dev",
        format: "yaml",
      }),
    );
    expect(data.values).toEqual({ K: "v" });
  });

  it("writeCell goes through sopsClient.encryptBlob then blobStore.writeBlob", async () => {
    const store = makeStorageBackend();
    const enc = makeEncryption();
    const source = composeSecretSource(store, enc, manifest);

    await source.writeCell({ namespace: "api", environment: "dev" }, { K: "v" });

    expect(enc.encrypt).toHaveBeenCalledWith(
      { K: "v" },
      expect.objectContaining({
        manifest,
        environment: "dev",
        format: "yaml",
      }),
    );
    expect(store.writeBlob).toHaveBeenCalledWith(
      { namespace: "api", environment: "dev" },
      "encrypted-bytes",
    );
  });

  it("deleteCell delegates to blobStore.deleteBlob", async () => {
    const store = makeStorageBackend({ "api/dev": "ciphertext" });
    const source = composeSecretSource(store, makeEncryption(), manifest);

    await source.deleteCell({ namespace: "api", environment: "dev" });
    expect(store.deleteBlob).toHaveBeenCalled();
  });

  it("cellExists delegates to blobStore.blobExists", async () => {
    const store = makeStorageBackend({ "api/dev": "x" });
    const source = composeSecretSource(store, makeEncryption(), manifest);

    expect(await source.cellExists({ namespace: "api", environment: "dev" })).toBe(true);
    expect(await source.cellExists({ namespace: "api", environment: "prod" })).toBe(false);
  });

  it("listKeys parses the SOPS YAML and excludes the sops metadata block", async () => {
    const blob = YAML.stringify({
      DATABASE_URL: "ENC[...]",
      API_KEY: "ENC[...]",
      sops: { age: [], lastmodified: "2026-01-01T00:00:00Z" },
    });
    const store = makeStorageBackend({ "api/dev": blob });
    const source = composeSecretSource(store, makeEncryption(), manifest);

    const keys = await source.listKeys({ namespace: "api", environment: "dev" });
    expect(keys).toEqual(["DATABASE_URL", "API_KEY"]);
  });

  it("listKeys returns empty array for a non-existent cell (no decrypt attempted)", async () => {
    const store = makeStorageBackend();
    const enc = makeEncryption();
    const source = composeSecretSource(store, enc, manifest);

    expect(await source.listKeys({ namespace: "api", environment: "dev" })).toEqual([]);
    expect(enc.decrypt).not.toHaveBeenCalled();
  });

  it("getCellMetadata reads the blob and uses sopsClient.getMetadataFromBlob (no decrypt)", async () => {
    const store = makeStorageBackend({ "api/dev": "ciphertext" });
    const enc = makeEncryption();
    const source = composeSecretSource(store, enc, manifest);

    await source.getCellMetadata({ namespace: "api", environment: "dev" });

    expect(enc.getMetadata).toHaveBeenCalledWith("ciphertext");
    expect(enc.decrypt).not.toHaveBeenCalled();
  });

  it("scaffoldCell is a no-op for an existing cell", async () => {
    const store = makeStorageBackend({ "api/dev": "x" });
    const enc = makeEncryption();
    const source = composeSecretSource(store, enc, manifest);

    await source.scaffoldCell({ namespace: "api", environment: "dev" }, manifest);
    expect(enc.encrypt).not.toHaveBeenCalled();
    expect(store.writeBlob).not.toHaveBeenCalled();
  });

  it("scaffoldCell creates an empty-values blob for a missing cell", async () => {
    const store = makeStorageBackend();
    const enc = makeEncryption();
    const source = composeSecretSource(store, enc, manifest);

    await source.scaffoldCell({ namespace: "api", environment: "dev" }, manifest);
    expect(enc.encrypt).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        manifest,
        environment: "dev",
        format: "yaml",
      }),
    );
    expect(store.writeBlob).toHaveBeenCalled();
  });
});

describe("composeSecretSource — pending metadata", () => {
  const cell = { namespace: "api", environment: "dev" };

  it("markPending appends a fresh pending entry", async () => {
    const store = makeStorageBackend({ "api/dev": "x" });
    const source = composeSecretSource(store, makeEncryption(), manifest);

    await source.markPending(cell, ["DB_URL"], "alice");
    const meta = await source.getPendingMetadata(cell);
    expect(meta.pending).toHaveLength(1);
    expect(meta.pending[0].key).toBe("DB_URL");
    expect(meta.pending[0].setBy).toBe("alice");
  });

  it("markPending is idempotent on the same key", async () => {
    const store = makeStorageBackend({ "api/dev": "x" });
    const source = composeSecretSource(store, makeEncryption(), manifest);
    await source.markPending(cell, ["K"], "alice");
    await source.markPending(cell, ["K"], "alice");
    const meta = await source.getPendingMetadata(cell);
    expect(meta.pending).toHaveLength(1);
  });

  it("markResolved removes only the specified keys", async () => {
    const store = makeStorageBackend({ "api/dev": "x" });
    const source = composeSecretSource(store, makeEncryption(), manifest);
    await source.markPending(cell, ["A", "B"], "alice");
    await source.markResolved(cell, ["A"]);
    const meta = await source.getPendingMetadata(cell);
    expect(meta.pending.map((p) => p.key)).toEqual(["B"]);
  });

  it("recordRotation increments rotationCount on subsequent rotations of the same key", async () => {
    const store = makeStorageBackend({ "api/dev": "x" });
    const source = composeSecretSource(store, makeEncryption(), manifest);
    await source.recordRotation(cell, ["K"], "alice");
    await source.recordRotation(cell, ["K"], "bob");
    const meta = await source.getPendingMetadata(cell);
    expect(meta.rotations).toHaveLength(1);
    expect(meta.rotations[0].rotationCount).toBe(2);
    expect(meta.rotations[0].rotatedBy).toBe("bob");
  });

  it("removeRotation drops only the specified keys", async () => {
    const store = makeStorageBackend({ "api/dev": "x" });
    const source = composeSecretSource(store, makeEncryption(), manifest);
    await source.recordRotation(cell, ["A", "B"], "alice");
    await source.removeRotation(cell, ["A"]);
    const meta = await source.getPendingMetadata(cell);
    expect(meta.rotations.map((r) => r.key)).toEqual(["B"]);
  });
});

describe("composeSecretSource — Lintable trait", () => {
  it("validateEncryption returns false for missing cells (no IO past blobExists)", async () => {
    const store = makeStorageBackend();
    const enc = makeEncryption();
    const source = composeSecretSource(store, enc, manifest);

    expect(await source.validateEncryption({ namespace: "api", environment: "dev" })).toBe(false);
    expect(enc.validateEncryption).not.toHaveBeenCalled();
  });

  it("validateEncryption delegates to sopsClient.validateEncryptionBlob for existing cells", async () => {
    const store = makeStorageBackend({ "api/dev": "ciphertext" });
    const enc = makeEncryption();
    const source = composeSecretSource(store, enc, manifest);

    expect(await source.validateEncryption({ namespace: "api", environment: "dev" })).toBe(true);
    expect(enc.validateEncryption).toHaveBeenCalledWith("ciphertext");
  });

  it("checkRecipientDrift surfaces missing and unexpected recipients", async () => {
    const store = makeStorageBackend({ "api/dev": "ciphertext" });
    const enc = makeEncryption();
    enc.getMetadata.mockReturnValue({
      backend: "age",
      recipients: ["age1abc", "age1unexpected"],
      lastModified: new Date(0),
      lastModifiedPresent: false,
    });
    const source = composeSecretSource(store, enc, manifest);

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
    const store = makeStorageBackend({ "api/dev": "ciphertext" });
    const enc = makeEncryption();
    const source = composeSecretSource(store, enc, manifest);

    await source.rotate({ namespace: "api", environment: "dev" }, "age1new");

    expect(enc.rotate).toHaveBeenCalledWith(
      "ciphertext",
      { addAge: "age1new" },
      expect.objectContaining({ manifest, environment: "dev", format: "yaml" }),
    );
    expect(store.writeBlob).toHaveBeenCalledWith(
      { namespace: "api", environment: "dev" },
      "rotated-bytes",
    );
  });
});

describe("composeSecretSource — Bulk trait", () => {
  it("copyValue copies a single key from one cell to another via core methods", async () => {
    const store = makeStorageBackend({ "api/dev": "x", "api/prod": "y" });
    const enc = makeEncryption();
    enc.decrypt.mockImplementation(async () => ({
      values: { K: "from-dev", OTHER: "x" },
      metadata: {
        backend: "age",
        recipients: ["age1abc"],
        lastModified: new Date(0),
        lastModifiedPresent: false,
      },
    }));
    const source = composeSecretSource(store, enc, manifest);

    await source.copyValue(
      "K",
      { namespace: "api", environment: "dev" },
      { namespace: "api", environment: "prod" },
      manifest,
    );

    expect(enc.encrypt).toHaveBeenCalled();
  });
});

describe("composeSecretSource — capability surface", () => {
  it("composed source reports lint/rotate/bulk capabilities", () => {
    const source = composeSecretSource(makeStorageBackend(), makeEncryption(), manifest);
    expect(isLintable(source)).toBe(true);
    expect(isRotatable(source)).toBe(true);
    expect(isBulk(source)).toBe(true);
  });

  it("composed source does NOT yet report recipients/merge/migrate/structural (deferred to later phases)", () => {
    const source = composeSecretSource(makeStorageBackend(), makeEncryption(), manifest);
    expect(isRecipientManaged(source)).toBe(false);
    expect(isMergeAware(source)).toBe(false);
    expect(isMigratable(source)).toBe(false);
    expect(isStructural(source)).toBe(false);
  });

  it("source.id and description compose both backends' identifiers", () => {
    const source = composeSecretSource(makeStorageBackend(), makeEncryption(), manifest);
    // Composed id reflects the orthogonal pair so `clef doctor` can show
    // exactly what the running source is built from.
    expect(source.id).toBe("mock-substrate+mock-encryption");
    expect(source.description).toContain("in-memory");
  });
});
