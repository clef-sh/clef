import * as fs from "fs";
import * as path from "path";
import type { PackedArtifact } from "@clef-sh/core";
import { buildDecryptResult, buildInspectResult, buildVerifyResult } from "../format";

/**
 * Binding CLI ↔ UI parity contract for `inspect` output (plan §10.1).
 *
 * The committed JSON fixtures in `envelope-snapshots/` are the single source
 * of truth for the wire shape of `--json` output and of the UI server's
 * `/api/envelope/inspect` response (added in PR 7). If either surface drifts,
 * this test fails and the fixtures must be intentionally regenerated.
 *
 * Fixtures are produced by `buildInspectResult` with a frozen `now` and a
 * hand-crafted {@link PackedArtifact}. No real sops / age / KMS calls.
 */

const FIXTURE_DIR = path.join(__dirname, "envelope-snapshots");
const NOW = new Date("2026-04-23T12:00:00.000Z").getTime();

const CIPHERTEXT = "ZmFrZS1hZ2UtY2lwaGVydGV4dC1mb3ItdGVzdGluZw==";
const CIPHERTEXT_HASH = "b555077dd41b180ebae2c2fc96665cebe1b9c164ca418c2b132786fdbec267fb";

function baseArtifact(overrides: Partial<PackedArtifact> = {}): PackedArtifact {
  return {
    version: 1,
    identity: "aws-lambda",
    environment: "dev",
    packedAt: "2026-04-23T06:00:00.000Z",
    revision: "1776880279983-24310ee5",
    ciphertext: CIPHERTEXT,
    ciphertextHash: CIPHERTEXT_HASH,
    ...overrides,
  };
}

function readFixture(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), "utf-8"));
}

describe("envelope-snapshots (binding CLI ↔ UI parity contract)", () => {
  it("inspect.age-only.json matches buildInspectResult for an age-only artifact", () => {
    const result = buildInspectResult("envelope.json", baseArtifact(), true, NOW);
    expect(result).toEqual(readFixture("inspect.age-only.json"));
  });

  it("inspect.kms.json matches buildInspectResult for a signed KMS artifact", () => {
    const artifact = baseArtifact({
      expiresAt: "2026-04-30T06:00:00.000Z",
      envelope: {
        provider: "aws",
        keyId: "arn:aws:kms:us-east-1:123456789012:key/abcd-1234",
        wrappedKey: "d3JhcHBlZA==",
        algorithm: "SYMMETRIC_DEFAULT",
        iv: "dGVzdC1pdg==",
        authTag: "dGVzdC1hdXRo",
      },
      signature: "dGVzdC1zaWc=",
      signatureAlgorithm: "Ed25519",
    });
    const result = buildInspectResult("envelope.json", artifact, true, NOW);
    expect(result).toEqual(readFixture("inspect.kms.json"));
  });

  it("inspect.hash-mismatch.json matches buildInspectResult when hash does not verify", () => {
    const artifact = baseArtifact({
      ciphertextHash: "deadbeef".repeat(8),
    });
    const result = buildInspectResult("envelope.json", artifact, false, NOW);
    expect(result).toEqual(readFixture("inspect.hash-mismatch.json"));
  });

  it("verify.pass.json matches buildVerifyResult for a fully passing artifact", () => {
    const result = buildVerifyResult("envelope.json", {
      hash: "ok",
      signature: { status: "valid", algorithm: "Ed25519" },
      expiry: { status: "ok", expiresAt: "2026-04-30T06:00:00.000Z" },
      revocation: { status: "absent", revokedAt: null },
    });
    expect(result).toEqual(readFixture("verify.pass.json"));
  });

  it("verify.signature-invalid.json matches buildVerifyResult for a tampered signature", () => {
    const result = buildVerifyResult("envelope.json", {
      hash: "ok",
      signature: { status: "invalid", algorithm: "Ed25519" },
      expiry: { status: "absent", expiresAt: null },
      revocation: { status: "absent", revokedAt: null },
    });
    expect(result).toEqual(readFixture("verify.signature-invalid.json"));
  });

  it("verify.no-signer-key.json matches buildVerifyResult when signature is present but not verified", () => {
    const result = buildVerifyResult("envelope.json", {
      hash: "ok",
      signature: { status: "not_verified", algorithm: "Ed25519" },
      expiry: { status: "absent", expiresAt: null },
      revocation: { status: "absent", revokedAt: null },
    });
    expect(result).toEqual(readFixture("verify.no-signer-key.json"));
  });

  const DECRYPT_KEYS = ["DB_URL", "REDIS_URL", "API_KEY"];
  const DECRYPT_VALUES = {
    DB_URL: "postgres://prod",
    REDIS_URL: "redis://prod",
    API_KEY: "sk-123",
  };

  it("decrypt.keys-only.json matches buildDecryptResult for the safe default", () => {
    const result = buildDecryptResult("envelope.json", { keys: DECRYPT_KEYS });
    expect(result).toEqual(readFixture("decrypt.keys-only.json"));
  });

  it("decrypt.revealed.json matches buildDecryptResult for --reveal", () => {
    const result = buildDecryptResult("envelope.json", {
      keys: DECRYPT_KEYS,
      allValues: DECRYPT_VALUES,
    });
    expect(result).toEqual(readFixture("decrypt.revealed.json"));
  });

  it("decrypt.single-key.json matches buildDecryptResult for --key <name>", () => {
    const result = buildDecryptResult("envelope.json", {
      keys: DECRYPT_KEYS,
      singleKey: { name: "DB_URL", value: "postgres://prod" },
    });
    expect(result).toEqual(readFixture("decrypt.single-key.json"));
  });
});
