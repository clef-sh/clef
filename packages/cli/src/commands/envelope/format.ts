import type { DecryptResult, InspectResult, VerifyResult } from "@clef-sh/core";

/**
 * Human-text renderers for `clef envelope` commands. The canonical output
 * shapes (InspectResult / VerifyResult / DecryptResult) and their pure
 * builders live in `@clef-sh/core/envelope-debug`; those are shared with
 * the UI server's `/api/envelope/*` endpoints. Only CLI-facing human
 * rendering stays here.
 */

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

// ── Inspect renderer ──────────────────────────────────────────────────────

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

// ── Verify renderer ───────────────────────────────────────────────────────

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

// ── Decrypt renderer ──────────────────────────────────────────────────────

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
