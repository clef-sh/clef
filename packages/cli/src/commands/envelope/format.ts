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
