import * as fs from "fs";
import { Router, Request, Response } from "express";
import {
  assertPackedArtifact,
  buildDecryptError,
  buildDecryptResult,
  buildInspectError,
  buildInspectResult,
  buildSigningPayload,
  buildVerifyError,
  buildVerifyResult,
  computeCiphertextHash,
  InvalidArtifactError,
  parseSignerKey,
  verifySignature,
} from "@clef-sh/core";
import type {
  ExpiryStatus,
  HashStatus,
  PackedArtifact,
  RevocationStatus,
  SignatureStatus,
  VerifyInputs,
} from "@clef-sh/core";
import { AgeDecryptor, ArtifactDecryptor } from "@clef-sh/runtime";

/**
 * Dependencies for the envelope debugger endpoints.
 *
 * Age identity is resolved by the server from its own environment — the D4
 * boundary: clients pass pasted JSON only, never keys or paths.
 */
export interface EnvelopeRouteDeps {
  /** Explicit age key file override (typically from CLI). Falls back to CLEF_AGE_KEY_FILE. */
  ageKeyFile?: string;
  /** Explicit inline age key override (typically from CLI). Falls back to CLEF_AGE_KEY. */
  ageKey?: string;
}

// Source label for all UI-initiated artifact inspections — makes it obvious
// in logs that the artifact came from a pasted input, not a file or URL.
const UI_SOURCE = "paste";

function setNoCacheHeaders(res: Response): void {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  });
}

// Precedence for the envelope debugger:
//   1. $CLEF_AGE_KEY       (explicit env override — inline)
//   2. $CLEF_AGE_KEY_FILE   (explicit env override — file path)
//   3. deps.ageKey          (from CLI's resolveAgeCredential — may be keychain)
//   4. deps.ageKeyFile      (from CLI's resolveAgeCredential — may be .clef/config.yaml)
//
// Env vars deliberately win over deps. The CLI's credential resolver
// prefers the OS keychain when configured, so without this override an
// operator who sets `CLEF_AGE_KEY_FILE=svc.key clef ui` to debug a
// service-identity-packed envelope would see their keychain key used
// instead — silently. Making env vars authoritative for the debugger
// lets operators target a specific identity without affecting the rest
// of `clef ui`.
function resolveAgeIdentity(deps: EnvelopeRouteDeps): {
  configured: boolean;
  source: "CLEF_AGE_KEY_FILE" | "CLEF_AGE_KEY" | null;
  path: string | null;
} {
  const envInline = process.env.CLEF_AGE_KEY;
  if (envInline) {
    return { configured: true, source: "CLEF_AGE_KEY", path: null };
  }
  const envFile = process.env.CLEF_AGE_KEY_FILE;
  if (envFile) {
    return { configured: true, source: "CLEF_AGE_KEY_FILE", path: envFile };
  }
  if (deps.ageKey) {
    return { configured: true, source: "CLEF_AGE_KEY", path: null };
  }
  if (deps.ageKeyFile) {
    return { configured: true, source: "CLEF_AGE_KEY_FILE", path: deps.ageKeyFile };
  }
  return { configured: false, source: null, path: null };
}

function loadAgePrivateKey(deps: EnvelopeRouteDeps): string {
  const ageDecryptor = new AgeDecryptor();
  // Same precedence as resolveAgeIdentity — env vars win over deps.
  if (process.env.CLEF_AGE_KEY) {
    return ageDecryptor.resolveKey(process.env.CLEF_AGE_KEY);
  }
  if (process.env.CLEF_AGE_KEY_FILE) {
    return ageDecryptor.resolveKey(undefined, process.env.CLEF_AGE_KEY_FILE);
  }
  if (deps.ageKey) return ageDecryptor.resolveKey(deps.ageKey);
  if (deps.ageKeyFile) return ageDecryptor.resolveKey(undefined, deps.ageKeyFile);
  throw new Error(
    "No age identity configured on the server. " +
      "Set CLEF_AGE_KEY_FILE or CLEF_AGE_KEY before launching `clef ui`.",
  );
}

export function registerEnvelopeRoutes(router: Router, deps: EnvelopeRouteDeps): void {
  // POST /api/envelope/inspect
  router.post("/envelope/inspect", (req: Request, res: Response) => {
    setNoCacheHeaders(res);
    const raw = (req.body ?? {}).raw;
    const verifyHash = (req.body ?? {}).verifyHash;
    if (typeof raw !== "string") {
      res.status(400).json({ error: "raw is required", code: "BAD_REQUEST" });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      res.json(buildInspectError(UI_SOURCE, "parse_failed", (err as Error).message));
      return;
    }

    try {
      assertPackedArtifact(parsed);
    } catch (err) {
      const message = err instanceof InvalidArtifactError ? err.message : (err as Error).message;
      res.json(buildInspectError(UI_SOURCE, "invalid_artifact", message));
      return;
    }

    const artifact = parsed as PackedArtifact;
    const hashOk =
      verifyHash === false
        ? true
        : computeCiphertextHash(artifact.ciphertext) === artifact.ciphertextHash;
    res.json(buildInspectResult(UI_SOURCE, artifact, hashOk));
  });

  // POST /api/envelope/verify
  router.post("/envelope/verify", (req: Request, res: Response) => {
    setNoCacheHeaders(res);
    const raw = (req.body ?? {}).raw;
    const signerKey = (req.body ?? {}).signerKey;
    if (typeof raw !== "string") {
      res.status(400).json({ error: "raw is required", code: "BAD_REQUEST" });
      return;
    }
    if (signerKey !== undefined && typeof signerKey !== "string") {
      res.status(400).json({ error: "signerKey must be a string", code: "BAD_REQUEST" });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      res.json(buildVerifyError(UI_SOURCE, "parse_failed", (err as Error).message));
      return;
    }

    try {
      assertPackedArtifact(parsed);
    } catch (err) {
      const message = err instanceof InvalidArtifactError ? err.message : (err as Error).message;
      res.json(buildVerifyError(UI_SOURCE, "invalid_artifact", message));
      return;
    }

    const artifact = parsed as PackedArtifact;

    const hashStatus: HashStatus =
      computeCiphertextHash(artifact.ciphertext) === artifact.ciphertextHash ? "ok" : "mismatch";

    const signature: { status: SignatureStatus; algorithm: string | null } = {
      status: "absent",
      algorithm: artifact.signatureAlgorithm ?? null,
    };
    if (typeof artifact.signature === "string") {
      if (signerKey) {
        let signerKeyBase64: string;
        try {
          // UI is paste-only: no file paths accepted (D4).
          signerKeyBase64 = parseSignerKey(signerKey);
        } catch (err) {
          res.json(buildVerifyError(UI_SOURCE, "signer_key_invalid", (err as Error).message));
          return;
        }
        const payload = buildSigningPayload(artifact);
        try {
          signature.status = verifySignature(payload, artifact.signature, signerKeyBase64)
            ? "valid"
            : "invalid";
        } catch (err) {
          signature.status = "invalid";
          signature.algorithm = `error: ${(err as Error).message}`;
        }
      } else {
        signature.status = "not_verified";
      }
    }

    const now = Date.now();
    let expiry: { status: ExpiryStatus; expiresAt: string | null };
    if (artifact.expiresAt) {
      const expired = new Date(artifact.expiresAt).getTime() < now;
      expiry = { status: expired ? "expired" : "ok", expiresAt: artifact.expiresAt };
    } else {
      expiry = { status: "absent", expiresAt: null };
    }

    const revocation: { status: RevocationStatus; revokedAt: string | null } = artifact.revokedAt
      ? { status: "revoked", revokedAt: artifact.revokedAt }
      : { status: "absent", revokedAt: null };

    const inputs: VerifyInputs = { hash: hashStatus, signature, expiry, revocation };
    res.json(buildVerifyResult(UI_SOURCE, inputs));
  });

  // POST /api/envelope/decrypt
  router.post("/envelope/decrypt", async (req: Request, res: Response) => {
    setNoCacheHeaders(res);
    const raw = (req.body ?? {}).raw;
    const reveal = (req.body ?? {}).reveal === true;
    const key = (req.body ?? {}).key;
    if (typeof raw !== "string") {
      res.status(400).json({ error: "raw is required", code: "BAD_REQUEST" });
      return;
    }
    if (key !== undefined && typeof key !== "string") {
      res.status(400).json({ error: "key must be a string", code: "BAD_REQUEST" });
      return;
    }
    if (reveal && key) {
      res.status(400).json({
        error: "reveal and key are mutually exclusive; pick one",
        code: "BAD_REQUEST",
      });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      res.json(buildDecryptError(UI_SOURCE, "parse_failed", (err as Error).message));
      return;
    }

    try {
      assertPackedArtifact(parsed);
    } catch (err) {
      const message = err instanceof InvalidArtifactError ? err.message : (err as Error).message;
      res.json(buildDecryptError(UI_SOURCE, "invalid_artifact", message));
      return;
    }

    const artifact = parsed as PackedArtifact;

    if (computeCiphertextHash(artifact.ciphertext) !== artifact.ciphertextHash) {
      res.json(
        buildDecryptError(
          UI_SOURCE,
          "hash_mismatch",
          "ciphertext hash does not match declared value",
        ),
      );
      return;
    }

    if (artifact.expiresAt && new Date(artifact.expiresAt).getTime() < Date.now()) {
      res.json(
        buildDecryptError(UI_SOURCE, "expired", `artifact expired at ${artifact.expiresAt}`),
      );
      return;
    }
    if (artifact.revokedAt) {
      res.json(
        buildDecryptError(UI_SOURCE, "revoked", `artifact was revoked at ${artifact.revokedAt}`),
      );
      return;
    }

    // Age identity is resolved from server environment only. Clients never
    // send keys. For KMS-enveloped artifacts the private key is not used —
    // ArtifactDecryptor reads ambient AWS credentials internally.
    let privateKey: string | undefined;
    if (!artifact.envelope) {
      try {
        privateKey = loadAgePrivateKey(deps);
      } catch (err) {
        res.json(buildDecryptError(UI_SOURCE, "key_resolution_failed", (err as Error).message));
        return;
      }
    }

    let values: Record<string, string>;
    try {
      const decryptor = new ArtifactDecryptor({ privateKey });
      ({ values } = await decryptor.decrypt(artifact));
    } catch (err) {
      res.json(buildDecryptError(UI_SOURCE, "decrypt_failed", (err as Error).message));
      return;
    }

    const keys = Object.keys(values);

    if (key) {
      if (!(key in values)) {
        res.json(
          buildDecryptError(
            UI_SOURCE,
            "unknown_key",
            `key "${key}" not present in decrypted payload`,
          ),
        );
        return;
      }
      res.json(
        buildDecryptResult(UI_SOURCE, { keys, singleKey: { name: key, value: values[key] } }),
      );
      return;
    }

    if (reveal) {
      res.json(buildDecryptResult(UI_SOURCE, { keys, allValues: values }));
      return;
    }
    res.json(buildDecryptResult(UI_SOURCE, { keys }));
  });

  // GET /api/envelope/config — tells the client which server-side identity
  // will be used for decrypt, so operators can diagnose key_resolution_failed.
  // Does NOT return key material, only metadata (env var name + optional path).
  router.get("/envelope/config", (_req: Request, res: Response) => {
    setNoCacheHeaders(res);
    const ageIdentity = resolveAgeIdentity(deps);
    const awsProfile = process.env.AWS_PROFILE ?? null;
    const hasCredentials =
      !!process.env.AWS_PROFILE ||
      !!process.env.AWS_ACCESS_KEY_ID ||
      !!process.env.AWS_ROLE_ARN ||
      !!process.env.AWS_WEB_IDENTITY_TOKEN_FILE ||
      // Well-known shared credentials file — if present assume AWS SDK will find creds.
      (!!process.env.HOME && fs.existsSync(`${process.env.HOME}/.aws/credentials`));
    res.json({
      ageIdentity,
      aws: { hasCredentials, profile: awsProfile },
    });
  });
}
