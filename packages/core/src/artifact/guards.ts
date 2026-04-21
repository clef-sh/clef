import { ClefError } from "../types";
import type { KmsEnvelope, PackedArtifact, SignatureAlgorithm } from "./types";

/** Discriminated union returned by {@link validatePackedArtifact}. */
export type ValidationResult<T> = { valid: true; value: T } | { valid: false; reason: string };

/**
 * Thrown by {@link assertPackedArtifact} when an unknown value does not
 * conform to the {@link PackedArtifact} shape. Follows the {@link ClefError}
 * convention so callers can catch uniformly.
 */
export class InvalidArtifactError extends ClefError {
  constructor(message: string) {
    super(
      message,
      "Ensure the artifact was produced by a compatible clef version and was not tampered with.",
    );
    this.name = "InvalidArtifactError";
  }
}

const VALID_SIGNATURE_ALGORITHMS: readonly SignatureAlgorithm[] = ["Ed25519", "ECDSA_SHA256"];

/**
 * Type predicate for {@link KmsEnvelope}. Verifies shape only — does not
 * check semantic validity (e.g. non-empty strings, valid base64).
 */
export function isKmsEnvelope(x: unknown): x is KmsEnvelope {
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.provider === "string" &&
    typeof o.keyId === "string" &&
    typeof o.wrappedKey === "string" &&
    typeof o.algorithm === "string" &&
    typeof o.iv === "string" &&
    typeof o.authTag === "string"
  );
}

/**
 * Validate an unknown value as a {@link PackedArtifact} and return a
 * discriminated result with a field-level reason on failure. Semantic
 * checks (non-empty strings, signature validity, expiry) live in the
 * runtime's poller, not here — this is a pure shape guard.
 */
export function validatePackedArtifact(x: unknown): ValidationResult<PackedArtifact> {
  if (typeof x !== "object" || x === null) {
    return { valid: false, reason: "expected object" };
  }
  const o = x as Record<string, unknown>;

  if (o.version !== 1) {
    return { valid: false, reason: `unsupported version: ${String(o.version)}` };
  }
  if (typeof o.identity !== "string") {
    return { valid: false, reason: "missing or invalid 'identity' (expected string)" };
  }
  if (typeof o.environment !== "string") {
    return { valid: false, reason: "missing or invalid 'environment' (expected string)" };
  }
  if (typeof o.packedAt !== "string") {
    return { valid: false, reason: "missing or invalid 'packedAt' (expected string)" };
  }
  if (typeof o.revision !== "string") {
    return { valid: false, reason: "missing or invalid 'revision' (expected string)" };
  }
  if (typeof o.ciphertextHash !== "string") {
    return { valid: false, reason: "missing or invalid 'ciphertextHash' (expected string)" };
  }
  if (typeof o.ciphertext !== "string") {
    return { valid: false, reason: "missing or invalid 'ciphertext' (expected string)" };
  }
  if (o.envelope !== undefined && !isKmsEnvelope(o.envelope)) {
    return { valid: false, reason: "invalid 'envelope' (expected KmsEnvelope shape)" };
  }
  if (o.expiresAt !== undefined && typeof o.expiresAt !== "string") {
    return { valid: false, reason: "invalid 'expiresAt' (expected string)" };
  }
  if (o.revokedAt !== undefined && typeof o.revokedAt !== "string") {
    return { valid: false, reason: "invalid 'revokedAt' (expected string)" };
  }
  if (o.signature !== undefined && typeof o.signature !== "string") {
    return { valid: false, reason: "invalid 'signature' (expected string)" };
  }
  if (
    o.signatureAlgorithm !== undefined &&
    !VALID_SIGNATURE_ALGORITHMS.includes(o.signatureAlgorithm as SignatureAlgorithm)
  ) {
    return {
      valid: false,
      reason: `invalid 'signatureAlgorithm': expected one of ${VALID_SIGNATURE_ALGORITHMS.join(", ")}`,
    };
  }

  return { valid: true, value: o as unknown as PackedArtifact };
}

/** Type predicate for {@link PackedArtifact}. */
export function isPackedArtifact(x: unknown): x is PackedArtifact {
  return validatePackedArtifact(x).valid;
}

/**
 * Assertion form of {@link validatePackedArtifact}. Throws with a
 * context-prefixed error message on invalid input. Intended for parse
 * boundaries (after `JSON.parse`) where a malformed artifact should be
 * a hard failure.
 */
export function assertPackedArtifact(x: unknown, context?: string): asserts x is PackedArtifact {
  const result = validatePackedArtifact(x);
  if (!result.valid) {
    const prefix = context ? `${context}: ` : "";
    throw new InvalidArtifactError(`${prefix}${result.reason}`);
  }
}
