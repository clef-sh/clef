import type { Command } from "commander";
import {
  InvalidArtifactError,
  assertPackedArtifact,
  buildSigningPayload,
  buildVerifyError,
  buildVerifyResult,
  computeCiphertextHash,
  parseSignerKey,
  verifySignature,
} from "@clef-sh/core";
import type {
  ExpiryStatus,
  HashStatus,
  RevocationStatus,
  SignatureStatus,
  VerifyInputs,
  VerifyResult,
} from "@clef-sh/core";
import type { ArtifactSource } from "@clef-sh/runtime";
import { formatter, isJsonMode } from "../../output/formatter";
import { resolveSource } from "./source";
import { renderVerifyHuman } from "./format";

interface VerifyOptions {
  signerKey?: string;
}

/**
 * Register `clef envelope verify` under the parent `envelope` command.
 *
 * Exit codes:
 *   0 — overall pass
 *   1 — argument / source-fetch / parse error
 *   2 — ciphertext hash mismatch
 *   3 — signature invalid
 *
 * Expiry and revocation are reported (in both human and JSON output) but do
 * not fail the command — use the envelope's own TTL plus your own CI logic
 * if you need to gate on them.
 */
export function registerVerifyCommand(parent: Command): void {
  parent
    .command("verify <source>")
    .description(
      "Verify ciphertext integrity and (optionally) signature for a single\n" +
        "packed artifact. Non-zero exit code lets CI gate on failures.",
    )
    .option(
      "--signer-key <pem|path|base64>",
      "Ed25519/ECDSA public key for signature verification (PEM string, file path, or base64 DER SPKI)",
    )
    .action(async (source: string, options: VerifyOptions) => {
      const result = await verifyOne(source, { signerKey: options.signerKey });

      if (isJsonMode()) {
        formatter.json(result);
      } else if (result.error) {
        formatter.error(`${result.source}: ${result.error.code} — ${result.error.message}`);
      } else {
        formatter.print(renderVerifyHuman(result));
      }

      process.exit(exitCodeFor(result));
    });
}

interface VerifyParams {
  signerKey?: string;
}

async function verifyOne(source: string, params: VerifyParams): Promise<VerifyResult> {
  let artifactSource: ArtifactSource;
  try {
    artifactSource = resolveSource(source);
  } catch (err) {
    return buildVerifyError(source, "source_invalid", (err as Error).message);
  }

  let raw: string;
  try {
    const result = await artifactSource.fetch();
    raw = result.raw;
  } catch (err) {
    return buildVerifyError(source, "fetch_failed", (err as Error).message);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return buildVerifyError(source, "parse_failed", (err as Error).message);
  }

  try {
    assertPackedArtifact(parsed);
  } catch (err) {
    const message = err instanceof InvalidArtifactError ? err.message : (err as Error).message;
    return buildVerifyError(source, "invalid_artifact", message);
  }

  const artifact = parsed as Parameters<typeof buildSigningPayload>[0];

  // Hash check — always performed.
  const hashStatus: HashStatus =
    computeCiphertextHash(artifact.ciphertext) === artifact.ciphertextHash ? "ok" : "mismatch";

  // Signature check
  const signature: { status: SignatureStatus; algorithm: string | null } = {
    status: "absent",
    algorithm: artifact.signatureAlgorithm ?? null,
  };
  if (typeof artifact.signature === "string") {
    if (params.signerKey) {
      let signerKeyBase64: string;
      try {
        signerKeyBase64 = parseSignerKey(params.signerKey, { allowFilePaths: true });
      } catch (err) {
        return buildVerifyError(source, "signer_key_invalid", (err as Error).message);
      }
      const payload = buildSigningPayload(artifact);
      try {
        signature.status = verifySignature(payload, artifact.signature, signerKeyBase64)
          ? "valid"
          : "invalid";
      } catch (err) {
        // Unsupported key type or crypto error — report as invalid rather than error.
        signature.status = "invalid";
        signature.algorithm = `error: ${(err as Error).message}`;
      }
    } else {
      signature.status = "not_verified";
    }
  }

  // Expiry / revocation — report-only.
  const now = Date.now();
  let expiry: { status: ExpiryStatus; expiresAt: string | null };
  if (artifact.expiresAt) {
    const expired = new Date(artifact.expiresAt).getTime() < now;
    expiry = { status: expired ? "expired" : "ok", expiresAt: artifact.expiresAt };
  } else {
    expiry = { status: "absent", expiresAt: null };
  }

  let revocation: { status: RevocationStatus; revokedAt: string | null };
  if (artifact.revokedAt) {
    revocation = { status: "revoked", revokedAt: artifact.revokedAt };
  } else {
    revocation = { status: "absent", revokedAt: null };
  }

  const inputs: VerifyInputs = { hash: hashStatus, signature, expiry, revocation };
  return buildVerifyResult(source, inputs);
}

function exitCodeFor(r: VerifyResult): number {
  if (r.error) return 1;
  if (r.checks.hash.status === "mismatch") return 2;
  if (r.checks.signature.status === "invalid") return 3;
  return 0;
}
