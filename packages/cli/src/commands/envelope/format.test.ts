import type { PackedArtifact } from "@clef-sh/core";
import {
  buildInspectError,
  buildInspectResult,
  buildVerifyError,
  buildVerifyResult,
  formatAge,
  formatSize,
  renderInspectHuman,
  renderVerifyHuman,
  shortHash,
} from "./format";

const NOW = new Date("2026-04-23T12:00:00.000Z").getTime();

function makeArtifact(overrides: Partial<PackedArtifact> = {}): PackedArtifact {
  return {
    version: 1,
    identity: "aws-lambda",
    environment: "dev",
    packedAt: "2026-04-23T06:00:00.000Z",
    revision: "1776880279983-24310ee5",
    ciphertextHash: "06ef4346abcdef0123456789abcdef0123456789abcdef0123456789ab62869c",
    ciphertext: Buffer.from("this-is-some-ciphertext-content-of-a-reasonable-size").toString(
      "base64",
    ),
    ...overrides,
  };
}

describe("formatAge", () => {
  it("returns 'just now' for sub-second differences", () => {
    expect(formatAge("2026-04-23T12:00:00.500Z", NOW)).toBe("just now");
  });

  it("returns seconds for <1m differences in the past", () => {
    expect(formatAge("2026-04-23T11:59:30.000Z", NOW)).toBe("30s ago");
  });

  it("returns minutes ago for <1h past", () => {
    expect(formatAge("2026-04-23T11:45:00.000Z", NOW)).toBe("15m ago");
  });

  it("returns hours ago for <1d past", () => {
    expect(formatAge("2026-04-23T06:00:00.000Z", NOW)).toBe("6h ago");
  });

  it("returns days ago for <1w past", () => {
    expect(formatAge("2026-04-20T12:00:00.000Z", NOW)).toBe("3d ago");
  });

  it("returns future relative time with 'in' prefix", () => {
    expect(formatAge("2026-04-30T12:00:00.000Z", NOW)).toBe("in 1w");
    expect(formatAge("2026-04-23T18:00:00.000Z", NOW)).toBe("in 6h");
  });

  it("returns 'invalid date' for unparseable input", () => {
    expect(formatAge("not a date", NOW)).toBe("invalid date");
  });
});

describe("formatSize", () => {
  it("uses B below 1024", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(1023)).toBe("1023 B");
  });

  it("uses KB between 1024 and 1024^2", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1945)).toBe("1.9 KB");
  });

  it("uses MB between 1024^2 and 1024^3", () => {
    expect(formatSize(2 * 1024 * 1024)).toBe("2.0 MB");
  });

  it("uses GB above 1024^3", () => {
    expect(formatSize(3 * 1024 * 1024 * 1024)).toBe("3.0 GB");
  });
});

describe("shortHash", () => {
  it("returns the full string when short", () => {
    expect(shortHash("abcdef")).toBe("abcdef");
  });

  it("truncates long hashes to first-8…last-5", () => {
    const hex = "06ef4346abcdef0123456789abcdef0123456789abcdef0123456789ab62869c";
    expect(shortHash(hex)).toBe("06ef4346…2869c");
  });
});

describe("buildInspectResult", () => {
  it("populates every field from a valid age-only artifact", () => {
    const artifact = makeArtifact();
    const r = buildInspectResult("envelope.json", artifact, true, NOW);

    expect(r.source).toBe("envelope.json");
    expect(r.version).toBe(1);
    expect(r.identity).toBe("aws-lambda");
    expect(r.environment).toBe("dev");
    expect(r.packedAt).toBe("2026-04-23T06:00:00.000Z");
    expect(r.packedAtAgeMs).toBe(6 * 60 * 60 * 1000);
    expect(r.ciphertextHashVerified).toBe(true);
    expect(r.ciphertextBytes).toBeGreaterThan(0);
    expect(r.envelope).toEqual({ provider: "age", kms: null });
    expect(r.signature.present).toBe(false);
    expect(r.error).toBeNull();
  });

  it("sets ciphertextHashVerified = null when hash check was skipped", () => {
    const artifact = makeArtifact();
    const r = buildInspectResult("envelope.json", artifact, null, NOW);
    expect(r.ciphertextHashVerified).toBeNull();
  });

  it("sets ciphertextHashVerified = false when hash does not match", () => {
    const artifact = makeArtifact();
    const r = buildInspectResult("envelope.json", artifact, false, NOW);
    expect(r.ciphertextHashVerified).toBe(false);
  });

  it("marks expired artifacts", () => {
    const artifact = makeArtifact({ expiresAt: "2026-04-22T06:00:00.000Z" });
    const r = buildInspectResult("envelope.json", artifact, true, NOW);
    expect(r.expired).toBe(true);
  });

  it("marks non-expired artifacts", () => {
    const artifact = makeArtifact({ expiresAt: "2026-04-30T06:00:00.000Z" });
    const r = buildInspectResult("envelope.json", artifact, true, NOW);
    expect(r.expired).toBe(false);
  });

  it("returns expired = null when expiresAt is absent", () => {
    const r = buildInspectResult("envelope.json", makeArtifact(), true, NOW);
    expect(r.expired).toBeNull();
  });

  it("marks revoked artifacts", () => {
    const artifact = makeArtifact({ revokedAt: "2026-04-22T06:00:00.000Z" });
    const r = buildInspectResult("envelope.json", artifact, true, NOW);
    expect(r.revoked).toBe(true);
    expect(r.revokedAt).toBe("2026-04-22T06:00:00.000Z");
  });

  it("populates KMS envelope fields", () => {
    const artifact = makeArtifact({
      envelope: {
        provider: "aws",
        keyId: "arn:aws:kms:us-east-1:123456789012:key/abcd-1234",
        wrappedKey: "d3JhcHBlZA==",
        algorithm: "SYMMETRIC_DEFAULT",
        iv: "dGVzdC1pdg==",
        authTag: "dGVzdC1hdXRo",
      },
    });
    const r = buildInspectResult("envelope.json", artifact, true, NOW);
    expect(r.envelope).toEqual({
      provider: "aws",
      kms: {
        provider: "aws",
        keyId: "arn:aws:kms:us-east-1:123456789012:key/abcd-1234",
        algorithm: "SYMMETRIC_DEFAULT",
      },
    });
  });

  it("records signature presence and algorithm", () => {
    const artifact = makeArtifact({
      signature: "dGVzdA==",
      signatureAlgorithm: "Ed25519",
    });
    const r = buildInspectResult("envelope.json", artifact, true, NOW);
    expect(r.signature).toEqual({
      present: true,
      algorithm: "Ed25519",
      verified: null,
    });
  });

  it("never elides fields — shape completeness", () => {
    const r = buildInspectResult("envelope.json", makeArtifact(), true, NOW);
    const keys = Object.keys(r).sort();
    expect(keys).toEqual(
      [
        "source",
        "version",
        "identity",
        "environment",
        "packedAt",
        "packedAtAgeMs",
        "revision",
        "ciphertextHash",
        "ciphertextHashVerified",
        "ciphertextBytes",
        "expiresAt",
        "expired",
        "revokedAt",
        "revoked",
        "envelope",
        "signature",
        "error",
      ].sort(),
    );
  });
});

describe("buildInspectError", () => {
  it("produces a shape with error populated and all other fields null", () => {
    const r = buildInspectError("envelope.json", "fetch_failed", "connection refused");
    expect(r.error).toEqual({ code: "fetch_failed", message: "connection refused" });
    expect(r.version).toBeNull();
    expect(r.identity).toBeNull();
    expect(r.ciphertextHash).toBeNull();
    expect(r.signature).toEqual({ present: false, algorithm: null, verified: null });
  });
});

describe("renderInspectHuman", () => {
  it("includes every documented field for a valid artifact", () => {
    const r = buildInspectResult("envelope.json", makeArtifact(), true, NOW);
    const out = renderInspectHuman(r, NOW);
    expect(out).toContain("version:");
    expect(out).toContain("identity:");
    expect(out).toContain("environment:");
    expect(out).toContain("packedAt:");
    expect(out).toContain("revision:");
    expect(out).toContain("ciphertextHash:");
    expect(out).toContain("ciphertext size:");
    expect(out).toContain("expiresAt:");
    expect(out).toContain("revokedAt:");
    expect(out).toContain("envelope:");
    expect(out).toContain("signature:");
  });

  it("suffixes the hash line with '(verified)' when hash matches", () => {
    const r = buildInspectResult("envelope.json", makeArtifact(), true, NOW);
    expect(renderInspectHuman(r, NOW)).toMatch(/ciphertextHash:.*\(verified\)/);
  });

  it("suffixes with '(MISMATCH)' when hash does not match", () => {
    const r = buildInspectResult("envelope.json", makeArtifact(), false, NOW);
    expect(renderInspectHuman(r, NOW)).toMatch(/ciphertextHash:.*\(MISMATCH\)/);
  });

  it("suffixes with '(skipped)' when hash verification was skipped", () => {
    const r = buildInspectResult("envelope.json", makeArtifact(), null, NOW);
    expect(renderInspectHuman(r, NOW)).toMatch(/ciphertextHash:.*\(skipped\)/);
  });

  it("shows 'age-only (no KMS wrap)' for age envelopes", () => {
    const r = buildInspectResult("envelope.json", makeArtifact(), true, NOW);
    expect(renderInspectHuman(r, NOW)).toContain("age-only (no KMS wrap)");
  });

  it("shows KMS provider and keyId for KMS envelopes", () => {
    const artifact = makeArtifact({
      envelope: {
        provider: "aws",
        keyId: "arn:aws:kms:test",
        wrappedKey: "d3JhcHBlZA==",
        algorithm: "SYMMETRIC_DEFAULT",
        iv: "dGVzdA==",
        authTag: "dGVzdA==",
      },
    });
    const r = buildInspectResult("envelope.json", artifact, true, NOW);
    expect(renderInspectHuman(r, NOW)).toContain("kms (aws, keyId=arn:aws:kms:test)");
  });

  it("shows 'expired' tag for expired artifacts", () => {
    const artifact = makeArtifact({ expiresAt: "2026-04-22T06:00:00.000Z" });
    const r = buildInspectResult("envelope.json", artifact, true, NOW);
    expect(renderInspectHuman(r, NOW)).toContain("(expired)");
  });

  it("shows 'absent' for missing signatures", () => {
    const r = buildInspectResult("envelope.json", makeArtifact(), true, NOW);
    expect(renderInspectHuman(r, NOW)).toMatch(/signature:\s+absent/);
  });

  it("shows 'present (<algo>)' for signed artifacts", () => {
    const artifact = makeArtifact({
      signature: "dGVzdA==",
      signatureAlgorithm: "Ed25519",
    });
    const r = buildInspectResult("envelope.json", artifact, true, NOW);
    expect(renderInspectHuman(r, NOW)).toMatch(/signature:\s+present \(Ed25519\)/);
  });

  it("renders an error result as a single line with code and message", () => {
    const r = buildInspectError("envelope.json", "fetch_failed", "connection refused");
    expect(renderInspectHuman(r)).toBe("envelope.json: fetch_failed — connection refused");
  });
});

describe("buildVerifyResult / buildVerifyError", () => {
  it("overall is 'pass' when hash ok + signature valid", () => {
    const r = buildVerifyResult("envelope.json", {
      hash: "ok",
      signature: { status: "valid", algorithm: "Ed25519" },
      expiry: { status: "absent", expiresAt: null },
      revocation: { status: "absent", revokedAt: null },
    });
    expect(r.overall).toBe("pass");
    expect(r.error).toBeNull();
  });

  it("overall is 'fail' on hash mismatch", () => {
    const r = buildVerifyResult("envelope.json", {
      hash: "mismatch",
      signature: { status: "not_verified", algorithm: null },
      expiry: { status: "absent", expiresAt: null },
      revocation: { status: "absent", revokedAt: null },
    });
    expect(r.overall).toBe("fail");
  });

  it("overall is 'fail' on signature invalid", () => {
    const r = buildVerifyResult("envelope.json", {
      hash: "ok",
      signature: { status: "invalid", algorithm: "Ed25519" },
      expiry: { status: "absent", expiresAt: null },
      revocation: { status: "absent", revokedAt: null },
    });
    expect(r.overall).toBe("fail");
  });

  it("expiry 'expired' does not flip overall to fail (report-only in v1)", () => {
    const r = buildVerifyResult("envelope.json", {
      hash: "ok",
      signature: { status: "valid", algorithm: "Ed25519" },
      expiry: { status: "expired", expiresAt: "2020-01-01T00:00:00.000Z" },
      revocation: { status: "absent", revokedAt: null },
    });
    expect(r.overall).toBe("pass");
  });

  it("revocation 'revoked' does not flip overall to fail (report-only in v1)", () => {
    const r = buildVerifyResult("envelope.json", {
      hash: "ok",
      signature: { status: "valid", algorithm: "Ed25519" },
      expiry: { status: "absent", expiresAt: null },
      revocation: { status: "revoked", revokedAt: "2026-04-20T00:00:00.000Z" },
    });
    expect(r.overall).toBe("pass");
  });

  it("buildVerifyError produces the documented error shape", () => {
    const r = buildVerifyError("envelope.json", "fetch_failed", "connection refused");
    expect(r.overall).toBe("fail");
    expect(r.error).toEqual({ code: "fetch_failed", message: "connection refused" });
    expect(r.checks.hash.status).toBe("skipped");
    expect(r.checks.signature.status).toBe("absent");
  });
});

describe("renderVerifyHuman", () => {
  const basePass = buildVerifyResult("envelope.json", {
    hash: "ok",
    signature: { status: "valid", algorithm: "Ed25519" },
    expiry: { status: "absent", expiresAt: null },
    revocation: { status: "absent", revokedAt: null },
  });

  it("includes every documented field", () => {
    const out = renderVerifyHuman(basePass);
    expect(out).toContain("source:");
    expect(out).toContain("ciphertextHash:");
    expect(out).toContain("signature:");
    expect(out).toContain("expiresAt:");
    expect(out).toContain("revokedAt:");
    expect(out).toContain("overall:");
  });

  it("shows 'OK' for hash.ok, 'MISMATCH' for hash.mismatch, 'skipped' otherwise", () => {
    expect(renderVerifyHuman(basePass)).toContain("ciphertextHash: OK");

    const mismatch = buildVerifyResult("envelope.json", {
      ...basePass.checks,
      hash: "mismatch",
      signature: basePass.checks.signature,
      expiry: basePass.checks.expiry,
      revocation: basePass.checks.revocation,
    });
    expect(renderVerifyHuman(mismatch)).toContain("ciphertextHash: MISMATCH");

    const skipped = buildVerifyResult("envelope.json", {
      hash: "skipped",
      signature: basePass.checks.signature,
      expiry: basePass.checks.expiry,
      revocation: basePass.checks.revocation,
    });
    expect(renderVerifyHuman(skipped)).toContain("ciphertextHash: skipped");
  });

  it("shows PASS/FAIL for overall", () => {
    expect(renderVerifyHuman(basePass)).toContain("overall:        PASS");
    const fail = buildVerifyResult("envelope.json", {
      hash: "mismatch",
      signature: basePass.checks.signature,
      expiry: basePass.checks.expiry,
      revocation: basePass.checks.revocation,
    });
    expect(renderVerifyHuman(fail)).toContain("overall:        FAIL");
  });

  it("renders 'INVALID' for invalid signatures", () => {
    const r = buildVerifyResult("envelope.json", {
      hash: "ok",
      signature: { status: "invalid", algorithm: "Ed25519" },
      expiry: { status: "absent", expiresAt: null },
      revocation: { status: "absent", revokedAt: null },
    });
    expect(renderVerifyHuman(r)).toMatch(/signature:\s+INVALID/);
  });

  it("renders a non-expired expiry with a relative time", () => {
    const now = new Date("2026-04-23T12:00:00.000Z").getTime();
    const r = buildVerifyResult("envelope.json", {
      hash: "ok",
      signature: { status: "valid", algorithm: "Ed25519" },
      expiry: { status: "ok", expiresAt: "2026-04-30T06:00:00.000Z" },
      revocation: { status: "absent", revokedAt: null },
    });
    expect(renderVerifyHuman(r, now)).toContain("2026-04-30T06:00:00.000Z (in 6d)");
  });

  it("renders an expired expiry with the '(expired)' tag", () => {
    const r = buildVerifyResult("envelope.json", {
      hash: "ok",
      signature: { status: "valid", algorithm: "Ed25519" },
      expiry: { status: "expired", expiresAt: "2020-01-01T00:00:00.000Z" },
      revocation: { status: "absent", revokedAt: null },
    });
    expect(renderVerifyHuman(r)).toContain("(expired)");
  });

  it("renders a revoked artifact with the revokedAt timestamp", () => {
    const r = buildVerifyResult("envelope.json", {
      hash: "ok",
      signature: { status: "valid", algorithm: "Ed25519" },
      expiry: { status: "absent", expiresAt: null },
      revocation: { status: "revoked", revokedAt: "2026-04-20T00:00:00.000Z" },
    });
    expect(renderVerifyHuman(r)).toContain("2026-04-20T00:00:00.000Z");
  });

  it("renders an error result as a single line with code and message", () => {
    const r = buildVerifyError("envelope.json", "fetch_failed", "connection refused");
    expect(renderVerifyHuman(r)).toBe("envelope.json: fetch_failed — connection refused");
  });
});
