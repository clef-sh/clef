/**
 * Pure builders that produce the envelope-debug output shapes from a
 * {@link PackedArtifact} and per-check inputs. No I/O.
 *
 * Consumed by both the CLI (`clef envelope {inspect,verify,decrypt}` with
 * `--json`) and the UI server (`/api/envelope/{inspect,verify,decrypt}`).
 * Golden-snapshot fixtures pin the output byte-for-byte.
 */

import type { PackedArtifact } from "../artifact/types";
import type {
  DecryptResult,
  DecryptSuccessInputs,
  InspectResult,
  OverallStatus,
  VerifyInputs,
  VerifyResult,
} from "./types";

// ── Inspect ────────────────────────────────────────────────────────────────

/** Build an {@link InspectResult} for a source that could not be fetched or parsed. */
export function buildInspectError(source: string, code: string, message: string): InspectResult {
  return {
    source,
    version: null,
    identity: null,
    environment: null,
    packedAt: null,
    packedAtAgeMs: null,
    revision: null,
    ciphertextHash: null,
    ciphertextHashVerified: null,
    ciphertextBytes: null,
    expiresAt: null,
    expired: null,
    revokedAt: null,
    revoked: null,
    envelope: null,
    signature: { present: false, algorithm: null, verified: null },
    error: { code, message },
  };
}

/**
 * Build an {@link InspectResult} from a parsed artifact.
 *
 * When `hashOk === null`, hash verification was skipped (`--no-verify-hash`).
 * `now` is injectable so tests produce deterministic `packedAtAgeMs` values.
 */
export function buildInspectResult(
  source: string,
  artifact: PackedArtifact,
  hashOk: boolean | null,
  now: number = Date.now(),
): InspectResult {
  const expiresAt = artifact.expiresAt ?? null;
  const revokedAt = artifact.revokedAt ?? null;
  const env = artifact.envelope;
  return {
    source,
    version: artifact.version,
    identity: artifact.identity,
    environment: artifact.environment,
    packedAt: artifact.packedAt,
    packedAtAgeMs: now - new Date(artifact.packedAt).getTime(),
    revision: artifact.revision,
    ciphertextHash: artifact.ciphertextHash,
    ciphertextHashVerified: hashOk,
    ciphertextBytes: Buffer.byteLength(artifact.ciphertext, "base64"),
    expiresAt,
    expired: expiresAt ? new Date(expiresAt).getTime() < now : null,
    revokedAt,
    revoked: revokedAt !== null,
    envelope: env
      ? {
          provider: env.provider,
          kms: {
            provider: env.provider,
            keyId: env.keyId,
            algorithm: env.algorithm,
          },
        }
      : { provider: "age", kms: null },
    signature: {
      present: typeof artifact.signature === "string",
      algorithm: artifact.signatureAlgorithm ?? null,
      verified: null,
    },
    error: null,
  };
}

// ── Verify ─────────────────────────────────────────────────────────────────

/** Build a {@link VerifyResult} for a source that could not be fetched or parsed. */
export function buildVerifyError(source: string, code: string, message: string): VerifyResult {
  return {
    source,
    checks: {
      hash: { status: "skipped" },
      signature: { status: "absent", algorithm: null },
      expiry: { status: "absent", expiresAt: null },
      revocation: { status: "absent", revokedAt: null },
    },
    overall: "fail",
    error: { code, message },
  };
}

/** Combine per-check results into a {@link VerifyResult} with `overall` derived. */
export function buildVerifyResult(source: string, inputs: VerifyInputs): VerifyResult {
  const hashFailed = inputs.hash === "mismatch";
  const signatureFailed = inputs.signature.status === "invalid";
  const overall: OverallStatus = hashFailed || signatureFailed ? "fail" : "pass";
  return {
    source,
    checks: {
      hash: { status: inputs.hash },
      signature: inputs.signature,
      expiry: inputs.expiry,
      revocation: inputs.revocation,
    },
    overall,
    error: null,
  };
}

// ── Decrypt ────────────────────────────────────────────────────────────────

/** Build a {@link DecryptResult} for a source that could not be decrypted. */
export function buildDecryptError(source: string, code: string, message: string): DecryptResult {
  return {
    source,
    status: "error",
    error: { code, message },
    revealed: false,
    keys: [],
    values: null,
  };
}

/** Build a success {@link DecryptResult}. Enforces the safe default: names only. */
export function buildDecryptResult(source: string, inputs: DecryptSuccessInputs): DecryptResult {
  let values: Record<string, string> | null = null;
  if (inputs.allValues) {
    values = inputs.allValues;
  } else if (inputs.singleKey) {
    values = { [inputs.singleKey.name]: inputs.singleKey.value };
  }
  return {
    source,
    status: "ok",
    error: null,
    revealed: values !== null,
    keys: [...inputs.keys].sort(),
    values,
  };
}
