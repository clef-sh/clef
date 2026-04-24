import type { Command } from "commander";
import { InvalidArtifactError, assertPackedArtifact, computeCiphertextHash } from "@clef-sh/core";
import { AgeDecryptor } from "@clef-sh/runtime";
import type { ArtifactSource } from "@clef-sh/runtime";
import { formatter, isJsonMode } from "../../output/formatter";
import { resolveSource } from "./source";
import {
  type DecryptResult,
  buildDecryptError,
  buildDecryptResult,
  renderDecryptHuman,
} from "./format";
import { REVEAL_WARNING } from "./warnings";

interface DecryptOptions {
  identity?: string;
  reveal?: boolean;
}

/**
 * Register `clef envelope decrypt` under the parent `envelope` command.
 *
 * Exit codes:
 *   0 — decrypt succeeded
 *   1 — generic / bad args / source unreachable
 *   2 — ciphertext hash mismatch
 *   4 — key resolution failure (no identity, decrypt failure)
 *   5 — expired or revoked
 *
 * Safety invariants:
 *   - Default output is key names only — values require `--reveal`.
 *   - Reveal warning to stderr emits ONLY AFTER all validation passes (hash,
 *     expiry, key resolution, decryption) and strictly BEFORE the first
 *     stdout byte. Protected by reveal-warning-ordering.test.ts.
 *   - No plaintext is ever written to disk. Protected by
 *     plaintext-never-to-disk.test.ts.
 *   - Identity resolution matches the existing CLEF_AGE_KEY_FILE /
 *     CLEF_AGE_KEY idiom — no `env:VAR` DSL.
 */
export function registerDecryptCommand(parent: Command): void {
  parent
    .command("decrypt <source>")
    .description(
      "Decrypt a packed artifact and print its contents. Default output is\n" +
        "key names only — values require `--reveal`.\n\n" +
        "Identity resolution order:\n" +
        "  1. --identity <path>\n" +
        "  2. $CLEF_AGE_KEY_FILE\n" +
        "  3. $CLEF_AGE_KEY (inline)",
    )
    .option(
      "--identity <path>",
      "Path to an age identity file. Overrides CLEF_AGE_KEY_FILE / CLEF_AGE_KEY.",
    )
    .option("--reveal", "Reveal all secret values (prints a warning to stderr)")
    .action(async (source: string, options: DecryptOptions) => {
      const revealAll = options.reveal === true;

      const result = await decryptOne(source, {
        identityPath: options.identity,
        revealAll,
      });

      const exitCode = exitCodeFor(result);

      // If decryption failed for any reason, emit the error and exit WITHOUT
      // printing the reveal warning. This is the ordering invariant.
      if (result.error) {
        if (isJsonMode()) {
          formatter.json(result);
        } else {
          formatter.error(`${result.source}: ${result.error.code} — ${result.error.message}`);
        }
        process.exit(exitCode);
        return;
      }

      // Reveal warning emits immediately before the first stdout byte of a
      // revealed value. A user who Ctrl-C's on the warning never sees plaintext.
      if (result.revealed) {
        writeStderr(REVEAL_WARNING + "\n");
      }

      if (isJsonMode()) {
        formatter.json(result);
      } else {
        formatter.print(renderDecryptHuman(result));
      }

      process.exit(exitCode);
    });
}

// Separate stderr write so the security test can intercept it without
// tangling with the formatter mock.
function writeStderr(s: string): void {
  process.stderr.write(s);
}

interface DecryptParams {
  identityPath?: string;
  revealAll: boolean;
}

async function decryptOne(source: string, params: DecryptParams): Promise<DecryptResult> {
  let artifactSource: ArtifactSource;
  try {
    artifactSource = resolveSource(source);
  } catch (err) {
    return buildDecryptError(source, "source_invalid", (err as Error).message);
  }

  let raw: string;
  try {
    const result = await artifactSource.fetch();
    raw = result.raw;
  } catch (err) {
    return buildDecryptError(source, "fetch_failed", (err as Error).message);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return buildDecryptError(source, "parse_failed", (err as Error).message);
  }

  try {
    assertPackedArtifact(parsed);
  } catch (err) {
    const message = err instanceof InvalidArtifactError ? err.message : (err as Error).message;
    return buildDecryptError(source, "invalid_artifact", message);
  }

  const artifact = parsed as Parameters<typeof assertPackedArtifact>[0] & {
    ciphertext: string;
    ciphertextHash: string;
    expiresAt?: string;
    revokedAt?: string;
    envelope?: unknown;
  };

  // Hash check — hard-fail on mismatch (corrupt ciphertext makes decrypt meaningless).
  const computed = computeCiphertextHash(artifact.ciphertext);
  if (computed !== artifact.ciphertextHash) {
    return buildDecryptError(
      source,
      "hash_mismatch",
      `ciphertext hash mismatch: expected ${artifact.ciphertextHash}, got ${computed}`,
    );
  }

  // Expiry hard-fail (matches poller.ts:244-250 runtime behavior).
  if (artifact.expiresAt && new Date(artifact.expiresAt).getTime() < Date.now()) {
    return buildDecryptError(source, "expired", `artifact expired at ${artifact.expiresAt}`);
  }

  // Revocation hard-fail.
  if (artifact.revokedAt) {
    return buildDecryptError(source, "revoked", `artifact was revoked at ${artifact.revokedAt}`);
  }

  // KMS-enveloped artifacts land in a follow-up PR.
  if (artifact.envelope) {
    return buildDecryptError(
      source,
      "unsupported_envelope",
      "KMS-enveloped artifact decryption lands in a follow-up PR; for now use a build that includes the KMS path.",
    );
  }

  // Resolve the age identity.
  let privateKey: string;
  try {
    privateKey = resolveAgeIdentity(params.identityPath);
  } catch (err) {
    return buildDecryptError(source, "key_resolution_failed", (err as Error).message);
  }

  // Decrypt.
  let plaintext: string;
  try {
    const decryptor = new AgeDecryptor();
    plaintext = await decryptor.decrypt(artifact.ciphertext, privateKey);
  } catch (err) {
    return buildDecryptError(source, "decrypt_failed", (err as Error).message);
  }

  // Parse the plaintext — packer writes JSON.stringify(values).
  let values: Record<string, string>;
  try {
    values = JSON.parse(plaintext) as Record<string, string>;
  } catch (err) {
    return buildDecryptError(source, "plaintext_parse_failed", (err as Error).message);
  }

  const keys = Object.keys(values);

  if (params.revealAll) {
    return buildDecryptResult(source, { keys, allValues: values });
  }

  return buildDecryptResult(source, { keys });
}

/**
 * Resolve the age identity per documented precedence:
 *   1. --identity <path>
 *   2. $CLEF_AGE_KEY_FILE
 *   3. $CLEF_AGE_KEY
 */
function resolveAgeIdentity(identityPath?: string): string {
  const decryptor = new AgeDecryptor();

  if (identityPath) {
    return decryptor.resolveKey(undefined, identityPath);
  }

  const envFile = process.env.CLEF_AGE_KEY_FILE;
  if (envFile) {
    return decryptor.resolveKey(undefined, envFile);
  }

  const envInline = process.env.CLEF_AGE_KEY;
  if (envInline) {
    return decryptor.resolveKey(envInline);
  }

  throw new Error(
    "No age identity configured. Provide one via --identity <path>, " +
      "CLEF_AGE_KEY_FILE=<path>, or CLEF_AGE_KEY=<inline key>.",
  );
}

function exitCodeFor(r: DecryptResult): number {
  if (!r.error) return 0;
  switch (r.error.code) {
    case "hash_mismatch":
      return 2;
    case "expired":
    case "revoked":
      return 5;
    case "key_resolution_failed":
    case "decrypt_failed":
      return 4;
    default:
      return 1;
  }
}
