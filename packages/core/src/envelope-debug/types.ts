/**
 * Shared output shapes for the envelope debugging surface.
 *
 * These types define the binding contract for both the `clef envelope`
 * CLI's `--json` output and the UI server's `/api/envelope/*` responses.
 * Golden-snapshot fixtures in `__fixtures__/envelope-snapshots/` pin the
 * wire shape byte-for-byte; changing a field here requires regenerating
 * those fixtures intentionally.
 *
 * Pure type declarations only — no runtime code. Builders live in
 * `./builders`.
 */

// ── Inspect ────────────────────────────────────────────────────────────────

/** Envelope descriptor used in both human and JSON inspect output. */
export type InspectEnvelope =
  | { provider: "age"; kms: null }
  | {
      provider: string;
      kms: {
        provider: string;
        keyId: string;
        algorithm: string;
      };
    };

/**
 * Shape of a single-source inspect result. Fields are never elided; absent
 * data is `null`. Error cases swap the success fields for an `error`
 * envelope.
 */
export interface InspectResult {
  source: string;
  version: number | null;
  identity: string | null;
  environment: string | null;
  packedAt: string | null;
  packedAtAgeMs: number | null;
  revision: string | null;
  ciphertextHash: string | null;
  ciphertextHashVerified: boolean | null;
  ciphertextBytes: number | null;
  expiresAt: string | null;
  expired: boolean | null;
  revokedAt: string | null;
  revoked: boolean | null;
  envelope: InspectEnvelope | null;
  signature: {
    present: boolean;
    algorithm: string | null;
    verified: boolean | null;
  };
  error: { code: string; message: string } | null;
}

// ── Verify ─────────────────────────────────────────────────────────────────

export type HashStatus = "ok" | "mismatch" | "skipped";
export type SignatureStatus = "valid" | "invalid" | "absent" | "not_verified";
export type ExpiryStatus = "ok" | "expired" | "absent";
export type RevocationStatus = "ok" | "revoked" | "absent";
export type OverallStatus = "pass" | "fail";

/**
 * Shape of a `verify` result.
 *
 * The `overall` field summarizes the four checks: `fail` if any is
 * `mismatch` or `invalid`, otherwise `pass`. Expiry and revocation are
 * reports-only in v1 — they do not flip `overall` to `fail`.
 */
export interface VerifyResult {
  source: string;
  checks: {
    hash: { status: HashStatus };
    signature: { status: SignatureStatus; algorithm: string | null };
    expiry: { status: ExpiryStatus; expiresAt: string | null };
    revocation: { status: RevocationStatus; revokedAt: string | null };
  };
  overall: OverallStatus;
  error: { code: string; message: string } | null;
}

export interface VerifyInputs {
  hash: HashStatus;
  signature: { status: SignatureStatus; algorithm: string | null };
  expiry: { status: ExpiryStatus; expiresAt: string | null };
  revocation: { status: RevocationStatus; revokedAt: string | null };
}

// ── Decrypt ────────────────────────────────────────────────────────────────

export type DecryptStatus = "ok" | "error";

/**
 * Shape of a `decrypt` result.
 *
 * `values` is `null` unless `--reveal` or `--key <name>` was passed;
 * `revealed` lets downstream scripts assert the expected safety posture.
 * Errors swap `status` to `"error"` and populate the `error` envelope.
 */
export interface DecryptResult {
  source: string;
  status: DecryptStatus;
  error: { code: string; message: string } | null;
  revealed: boolean;
  keys: string[];
  values: Record<string, string> | null;
}

export interface DecryptSuccessInputs {
  /** Key names from the decrypted payload. Always present (sorted by the builder). */
  keys: string[];
  /** Full key-value map, only set when `--reveal` was passed. */
  allValues?: Record<string, string>;
  /**
   * Single-key disclosure — set when `--key <name>` was passed. Reduces the
   * render surface to one value; the rest remain hidden. Mutually exclusive
   * with `allValues` at the command layer (the command validates this).
   */
  singleKey?: { name: string; value: string };
}
