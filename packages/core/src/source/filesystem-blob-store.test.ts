import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ClefManifest } from "../types";

import { FilesystemBlobStore } from "./filesystem-blob-store";

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "clef-fs-blob-store-"));
}

function manifest(): ClefManifest {
  return {
    version: 1,
    environments: [{ name: "dev", description: "" }],
    namespaces: [{ name: "api", description: "" }],
    sops: { default_backend: "age" },
    file_pattern: "{namespace}/{environment}.enc.yaml",
  };
}

describe("FilesystemBlobStore", () => {
  let root: string;
  beforeEach(() => {
    root = makeTempRoot();
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  describe("cellPath", () => {
    it("substitutes {namespace} and {environment} in file_pattern", () => {
      const store = new FilesystemBlobStore(manifest(), root);
      const p = store.cellPath({ namespace: "api", environment: "dev" });
      expect(p).toBe(path.join(root, "api/dev.enc.yaml"));
    });

    it("honors a JSON file_pattern", () => {
      const m = { ...manifest(), file_pattern: "{namespace}/{environment}.enc.json" };
      const store = new FilesystemBlobStore(m, root);
      const p = store.cellPath({ namespace: "api", environment: "dev" });
      expect(p.endsWith(".enc.json")).toBe(true);
    });
  });

  describe("blobFormat", () => {
    it("returns 'yaml' for .enc.yaml file_pattern", () => {
      const store = new FilesystemBlobStore(manifest(), root);
      expect(store.blobFormat({ namespace: "api", environment: "dev" })).toBe("yaml");
    });

    it("returns 'json' for .enc.json file_pattern", () => {
      const m = { ...manifest(), file_pattern: "{namespace}/{environment}.enc.json" };
      const store = new FilesystemBlobStore(m, root);
      expect(store.blobFormat({ namespace: "api", environment: "dev" })).toBe("json");
    });
  });

  describe("writeBlob / readBlob / blobExists", () => {
    it("writes a blob, then reads it back verbatim", async () => {
      const store = new FilesystemBlobStore(manifest(), root);
      const cell = { namespace: "api", environment: "dev" };
      await store.writeBlob(cell, "encrypted-bytes");
      expect(await store.blobExists(cell)).toBe(true);
      expect(await store.readBlob(cell)).toBe("encrypted-bytes");
    });

    it("creates intermediate directories on first write", async () => {
      const store = new FilesystemBlobStore(manifest(), root);
      await store.writeBlob({ namespace: "billing", environment: "prod" }, "bytes");
      expect(fs.existsSync(path.join(root, "billing/prod.enc.yaml"))).toBe(true);
    });

    it("blobExists returns false before any write", async () => {
      const store = new FilesystemBlobStore(manifest(), root);
      expect(await store.blobExists({ namespace: "api", environment: "dev" })).toBe(false);
    });

    it("writeBlob is idempotent — second write replaces, doesn't append", async () => {
      const store = new FilesystemBlobStore(manifest(), root);
      const cell = { namespace: "api", environment: "dev" };
      await store.writeBlob(cell, "first");
      await store.writeBlob(cell, "second");
      expect(await store.readBlob(cell)).toBe("second");
    });
  });

  describe("deleteBlob", () => {
    it("removes the blob file", async () => {
      const store = new FilesystemBlobStore(manifest(), root);
      const cell = { namespace: "api", environment: "dev" };
      await store.writeBlob(cell, "bytes");
      await store.deleteBlob(cell);
      expect(await store.blobExists(cell)).toBe(false);
    });

    it("is a no-op when the blob does not exist", async () => {
      const store = new FilesystemBlobStore(manifest(), root);
      await expect(
        store.deleteBlob({ namespace: "api", environment: "dev" }),
      ).resolves.toBeUndefined();
    });

    it("removes the .clef-meta.yaml sidecar alongside the blob", async () => {
      const store = new FilesystemBlobStore(manifest(), root);
      const cell = { namespace: "api", environment: "dev" };
      await store.writeBlob(cell, "bytes");
      await store.writePendingMetadata(cell, {
        version: 1,
        pending: [{ key: "K", since: new Date(), setBy: "alice" }],
        rotations: [],
      });
      const sidecar = path.join(root, "api/dev.clef-meta.yaml");
      expect(fs.existsSync(sidecar)).toBe(true);
      await store.deleteBlob(cell);
      expect(fs.existsSync(sidecar)).toBe(false);
    });
  });

  describe("readPendingMetadata / writePendingMetadata", () => {
    it("returns empty metadata when no sidecar exists", async () => {
      const store = new FilesystemBlobStore(manifest(), root);
      const meta = await store.readPendingMetadata({ namespace: "api", environment: "dev" });
      expect(meta).toEqual({ version: 1, pending: [], rotations: [] });
    });

    it("round-trips pending entries through the sidecar", async () => {
      const store = new FilesystemBlobStore(manifest(), root);
      const cell = { namespace: "api", environment: "dev" };
      const since = new Date("2026-01-01T00:00:00Z");
      await store.writePendingMetadata(cell, {
        version: 1,
        pending: [{ key: "DB_URL", since, setBy: "alice" }],
        rotations: [],
      });
      const meta = await store.readPendingMetadata(cell);
      expect(meta.pending).toHaveLength(1);
      expect(meta.pending[0].key).toBe("DB_URL");
      expect(meta.pending[0].setBy).toBe("alice");
    });

    it("round-trips rotation records", async () => {
      const store = new FilesystemBlobStore(manifest(), root);
      const cell = { namespace: "api", environment: "dev" };
      await store.writePendingMetadata(cell, {
        version: 1,
        pending: [],
        rotations: [
          {
            key: "STRIPE_KEY",
            lastRotatedAt: new Date("2026-03-01T00:00:00Z"),
            rotatedBy: "alice",
            rotationCount: 3,
          },
        ],
      });
      const meta = await store.readPendingMetadata(cell);
      expect(meta.rotations).toHaveLength(1);
      expect(meta.rotations[0].rotationCount).toBe(3);
    });
  });

  describe("getRepoRoot", () => {
    it("returns the constructor-provided repo root", () => {
      const store = new FilesystemBlobStore(manifest(), root);
      expect(store.getRepoRoot()).toBe(root);
    });
  });

  describe("identifiers", () => {
    it("id is 'filesystem'", () => {
      expect(new FilesystemBlobStore(manifest(), root).id).toBe("filesystem");
    });
  });
});
