import type { PackedArtifact } from "@clef-sh/core";

/**
 * Render a relative-time string suitable for humans ("6h ago", "in 6d", "just now").
 *
 * Uses a small fixed unit table — no external dependency. Deterministic output
 * when `now` is provided, which the tests rely on.
 */
export function formatAge(iso: string, now: number = Date.now()): string {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return "invalid date";

  const diffMs = target - now;
  const absMs = Math.abs(diffMs);
  const future = diffMs > 0;

  const units: [number, string][] = [
    [365 * 24 * 60 * 60 * 1000, "y"],
    [30 * 24 * 60 * 60 * 1000, "mo"],
    [7 * 24 * 60 * 60 * 1000, "w"],
    [24 * 60 * 60 * 1000, "d"],
    [60 * 60 * 1000, "h"],
    [60 * 1000, "m"],
    [1000, "s"],
  ];

  for (const [ms, unit] of units) {
    if (absMs >= ms) {
      const n = Math.floor(absMs / ms);
      return future ? `in ${n}${unit}` : `${n}${unit} ago`;
    }
  }
  return "just now";
}

/** Render a byte count as a short human-readable string (e.g. "1.9 KB"). */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Shortened hash for display — first 8 and last 5 hex chars joined by an ellipsis. */
export function shortHash(hex: string): string {
  if (hex.length <= 16) return hex;
  return `${hex.slice(0, 8)}…${hex.slice(-5)}`;
}

// ── Inspect output shape ───────────────────────────────────────────────────

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
 * Shape of a single-source inspect result. This is the binding contract for
 * `--json` output and for the UI's `/api/envelope/inspect` response — shared
 * golden-snapshot fixtures assert this shape byte-for-byte.
 *
 * Fields are never elided; absent data is `null`. Error cases swap the
 * success fields for an `error` envelope.
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

// ── Human renderer ────────────────────────────────────────────────────────

/**
 * Render a single {@link InspectResult} as the canonical human block.
 * Returns the string; callers choose whether to print directly or buffer
 * (multi-source needs separator logic in the caller).
 */
export function renderInspectHuman(r: InspectResult, now: number = Date.now()): string {
  if (r.error) {
    return `${r.source}: ${r.error.code} — ${r.error.message}`;
  }

  const lines: string[] = [];
  const pad = (k: string) => k.padEnd(18);

  lines.push(`${pad("version:")}${r.version}`);
  lines.push(`${pad("identity:")}${r.identity}`);
  lines.push(`${pad("environment:")}${r.environment}`);
  lines.push(`${pad("packedAt:")}${r.packedAt}  (${formatAge(r.packedAt ?? "", now)})`);
  lines.push(`${pad("revision:")}${r.revision}`);

  const hashSuffix =
    r.ciphertextHashVerified === true
      ? "  (verified)"
      : r.ciphertextHashVerified === false
        ? "  (MISMATCH)"
        : "  (skipped)";
  lines.push(`${pad("ciphertextHash:")}${shortHash(r.ciphertextHash ?? "")}${hashSuffix}`);

  lines.push(`${pad("ciphertext size:")}${formatSize(r.ciphertextBytes ?? 0)}  (base64 wire)`);

  if (r.expiresAt) {
    const tag = r.expired ? " (expired)" : ` (${formatAge(r.expiresAt, now)})`;
    lines.push(`${pad("expiresAt:")}${r.expiresAt}${tag}`);
  } else {
    lines.push(`${pad("expiresAt:")}—`);
  }

  lines.push(`${pad("revokedAt:")}${r.revokedAt ?? "—"}`);

  if (r.envelope?.kms) {
    lines.push(
      `${pad("envelope:")}kms (${r.envelope.kms.provider}, keyId=${r.envelope.kms.keyId})`,
    );
  } else {
    lines.push(`${pad("envelope:")}age-only (no KMS wrap)`);
  }

  if (r.signature.present) {
    const algo = r.signature.algorithm ?? "unknown";
    lines.push(`${pad("signature:")}present (${algo})`);
  } else {
    lines.push(`${pad("signature:")}absent`);
  }

  return lines.join("\n");
}

// ── Verify output shape ───────────────────────────────────────────────────

export type HashStatus = "ok" | "mismatch" | "skipped";
export type SignatureStatus = "valid" | "invalid" | "absent" | "not_verified";
export type ExpiryStatus = "ok" | "expired" | "absent";
export type RevocationStatus = "ok" | "revoked" | "absent";
export type OverallStatus = "pass" | "fail";

/**
 * Shape of a `verify` result. Binding contract for `--json` output and for
 * the UI server's `/api/envelope/verify` response (PR 7).
 *
 * The `overall` field summarizes the four checks: `fail` if any is `mismatch`
 * or `invalid`, otherwise `pass`. Expiry and revocation are reports-only in
 * v1 (plan §6.2 step 5) — they do not flip `overall` to `fail`.
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

export interface VerifyInputs {
  hash: HashStatus;
  signature: { status: SignatureStatus; algorithm: string | null };
  expiry: { status: ExpiryStatus; expiresAt: string | null };
  revocation: { status: RevocationStatus; revokedAt: string | null };
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

/** Render a single {@link VerifyResult} as the canonical human block. */
export function renderVerifyHuman(r: VerifyResult, now: number = Date.now()): string {
  if (r.error) {
    return `${r.source}: ${r.error.code} — ${r.error.message}`;
  }

  const lines: string[] = [];
  const pad = (k: string) => k.padEnd(16);
  lines.push(`${pad("source:")}${r.source}`);

  const hashLabel =
    r.checks.hash.status === "ok"
      ? "OK"
      : r.checks.hash.status === "mismatch"
        ? "MISMATCH"
        : "skipped";
  lines.push(`${pad("ciphertextHash:")}${hashLabel}`);

  const sig = r.checks.signature;
  let sigLine: string;
  if (sig.status === "valid") {
    sigLine = `valid (${sig.algorithm ?? "unknown"}, signer matches --signer-key)`;
  } else if (sig.status === "invalid") {
    sigLine = `INVALID (${sig.algorithm ?? "unknown"})`;
  } else if (sig.status === "absent") {
    sigLine = "absent";
  } else {
    sigLine = `present (${sig.algorithm ?? "unknown"}, not verified — no --signer-key)`;
  }
  lines.push(`${pad("signature:")}${sigLine}`);

  const exp = r.checks.expiry;
  if (exp.status === "absent") {
    lines.push(`${pad("expiresAt:")}—`);
  } else if (exp.status === "expired") {
    lines.push(`${pad("expiresAt:")}${exp.expiresAt} (expired)`);
  } else {
    lines.push(`${pad("expiresAt:")}${exp.expiresAt} (${formatAge(exp.expiresAt ?? "", now)})`);
  }

  const rev = r.checks.revocation;
  if (rev.status === "absent") {
    lines.push(`${pad("revokedAt:")}—`);
  } else {
    lines.push(`${pad("revokedAt:")}${rev.revokedAt}`);
  }

  lines.push(`${pad("overall:")}${r.overall === "pass" ? "PASS" : "FAIL"}`);

  return lines.join("\n");
}

// ── Decrypt output shape ───────────────────────────────────────────────────

export type DecryptStatus = "ok" | "error";

/**
 * Shape of a `decrypt` result. Binding contract for `--json` output and for
 * the UI server's `/api/envelope/decrypt` response (PR 7).
 *
 * `values` is `null` unless `--reveal` was passed; `revealed` lets downstream
 * scripts assert the expected safety posture. Errors swap `status` to
 * `"error"` and populate the `error` envelope.
 */
export interface DecryptResult {
  source: string;
  status: DecryptStatus;
  error: { code: string; message: string } | null;
  revealed: boolean;
  keys: string[];
  values: Record<string, string> | null;
}

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

export interface DecryptSuccessInputs {
  /** Key names from the decrypted payload. Always present (sorted by the builder). */
  keys: string[];
  /** Full key-value map, only set when `--reveal` was passed. */
  allValues?: Record<string, string>;
}

/** Build a success {@link DecryptResult}. Enforces the safe default: names only. */
export function buildDecryptResult(source: string, inputs: DecryptSuccessInputs): DecryptResult {
  const values = inputs.allValues ?? null;
  return {
    source,
    status: "ok",
    error: null,
    revealed: values !== null,
    keys: [...inputs.keys].sort(),
    values,
  };
}

/**
 * Render a {@link DecryptResult} as text suitable for stdout in human mode.
 *
 *   - Not revealed  →  one key name per line (no values, ever).
 *   - Revealed      →  KEY=value lines. Values with whitespace, `=`, `#`, `"`,
 *                      or newlines are double-quoted with inner quotes and
 *                      newlines escaped.
 *
 * `--json` mode callers use `formatter.json(result)` instead — never this
 * function. This renderer never emits a value that was not revealed.
 */
export function renderDecryptHuman(r: DecryptResult): string {
  if (r.error) {
    return `${r.source}: ${r.error.code} — ${r.error.message}`;
  }
  if (!r.values) {
    return r.keys.join("\n");
  }
  return Object.entries(r.values)
    .map(([k, v]) => `${k}=${escapeKeyValue(v)}`)
    .join("\n");
}

function escapeKeyValue(value: string): string {
  if (/[\s="#]|\n/.test(value)) {
    return `"${value.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return value;
}
