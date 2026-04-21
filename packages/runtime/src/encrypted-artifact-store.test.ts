import { EncryptedArtifactStore } from "./encrypted-artifact-store";
import type { PackedArtifact } from "@clef-sh/core";

function makeEnvelope(revision = "rev-1"): PackedArtifact {
  return {
    version: 1,
    identity: "api-gateway",
    environment: "production",
    packedAt: "2024-01-15T00:00:00.000Z",
    revision,
    ciphertextHash: "abc123",
    ciphertext: "encrypted-blob",
  };
}

describe("EncryptedArtifactStore", () => {
  it("should return null before any swap", () => {
    const store = new EncryptedArtifactStore();
    expect(store.get()).toBeNull();
    expect(store.isReady()).toBe(false);
    expect(store.getRevision()).toBeNull();
    expect(store.getStoredAt()).toBeNull();
  });

  it("should store and return artifact after swap", () => {
    const store = new EncryptedArtifactStore();
    const envelope = makeEnvelope();
    store.swap(envelope);

    expect(store.get()).toBe(envelope);
    expect(store.isReady()).toBe(true);
    expect(store.getRevision()).toBe("rev-1");
    expect(store.getStoredAt()).toBeGreaterThan(0);
  });

  it("should replace artifact on subsequent swap", () => {
    const store = new EncryptedArtifactStore();
    store.swap(makeEnvelope("rev-1"));
    store.swap(makeEnvelope("rev-2"));

    expect(store.getRevision()).toBe("rev-2");
  });

  it("should clear on wipe", () => {
    const store = new EncryptedArtifactStore();
    store.swap(makeEnvelope());
    expect(store.isReady()).toBe(true);

    store.wipe();
    expect(store.get()).toBeNull();
    expect(store.isReady()).toBe(false);
    expect(store.getRevision()).toBeNull();
    expect(store.getStoredAt()).toBeNull();
  });
});
