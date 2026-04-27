import type { Command } from "commander";
import {
  InvalidArtifactError,
  assertPackedArtifact,
  buildDecryptError,
  buildDecryptResult,
  computeCiphertextHash,
  formatRevealWarning,
} from "@clef-sh/core";
import type { DecryptResult, PackedArtifact } from "@clef-sh/core";
import { AgeDecryptor, ArtifactDecryptor } from "@clef-sh/runtime";
import type { ArtifactSource } from "@clef-sh/runtime";
import { formatter, isJsonMode } from "../../output/formatter";
import { resolveSource } from "./source";
import { renderDecryptHuman } from "./format";

interface DecryptOptions {
  identity?: string;
  reveal?: boolean;
  key?: string;
}

/**
 * Register `clef envelope decrypt` under the parent `envelope` command.
 *
 * Supports both age-only and KMS-enveloped artifacts. For age-only, an age
 * identity must be configured via --identity / CLEF_AGE_KEY_FILE / CLEF_AGE_KEY.
 * For KMS-enveloped artifacts, ambient AWS credentials are used (AWS_PROFILE,
 * AWS_ROLE_ARN, instance role — decision D1).
 *
 * Exit codes:
 *   0 — decrypt succeeded
 *   1 — generic / bad args / source unreachable
 *   2 — ciphertext hash mismatch
 *   4 — key resolution failure (no identity for age, or decrypt failure)
 *   5 — expired or revoked
 *
 * Safety invariants (tested):
 *   - Default output is key names only — values require --reveal.
 *   - Reveal warning emits ONLY AFTER all validation + decryption passes and
 *     strictly BEFORE the first stdout byte. See reveal-warning-ordering test.
 *   - No plaintext is ever written to disk. See plaintext-never-to-disk test.
 */
export function registerDecryptCommand(parent: Command): void {
  parent
    .command("decrypt <source>")
    .description(
      "Decrypt a packed artifact and print its contents. Default output is\n" +
        "key names only — values require `--reveal`.\n\n" +
        "Age-only artifacts: identity resolution order\n" +
        "  1. --identity <path>\n" +
        "  2. $CLEF_AGE_KEY_FILE\n" +
        "  3. $CLEF_AGE_KEY (inline)\n\n" +
        "KMS-enveloped artifacts: uses ambient AWS credentials\n" +
        "(AWS_PROFILE, AWS_ROLE_ARN, instance role).",
    )
    .option(
      "--identity <path>",
      "Path to an age identity file. Overrides CLEF_AGE_KEY_FILE / CLEF_AGE_KEY. Ignored for KMS envelopes.",
    )
    .option("--reveal", "Reveal all secret values (prints a warning to stderr)")
    .option(
      "--key <name>",
      "Reveal just one named key's value. Narrower disclosure than --reveal; safer for shoulder-surfing scenarios.",
    )
    .action(async (source: string, options: DecryptOptions) => {
      const revealAll = options.reveal === true;
      const singleKey = options.key;

      if (revealAll && singleKey) {
        const msg = "--reveal and --key are mutually exclusive; pick one";
        if (isJsonMode()) {
          formatter.json({ error: true, message: msg });
        } else {
          formatter.error(msg);
        }
        process.exit(1);
        return;
      }

      const result = await decryptOne(source, {
        identityPath: options.identity,
        revealAll,
        singleKey,
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
      // The key-named variant names the single value so the operator can make
      // an informed disclosure call (narrower surface than --reveal).
      if (result.revealed) {
        writeStderr(formatRevealWarning(singleKey) + "\n");
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
  singleKey?: string;
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

  const artifact = parsed as PackedArtifact;

  // Hash check — hard-fail on mismatch (corrupt ciphertext makes decrypt meaningless).
  if (computeCiphertextHash(artifact.ciphertext) !== artifact.ciphertextHash) {
    return buildDecryptError(
      source,
      "hash_mismatch",
      "ciphertext hash does not match declared value",
    );
  }

  // Expiry / revocation hard-fail (matches runtime poller behavior).
  if (artifact.expiresAt && new Date(artifact.expiresAt).getTime() < Date.now()) {
    return buildDecryptError(source, "expired", `artifact expired at ${artifact.expiresAt}`);
  }
  if (artifact.revokedAt) {
    return buildDecryptError(source, "revoked", `artifact was revoked at ${artifact.revokedAt}`);
  }

  // Resolve the age identity. Required for age-only; ignored for KMS envelopes
  // (AWS credentials are resolved by the KMS provider internally).
  let privateKey: string | undefined;
  if (!artifact.envelope) {
    try {
      privateKey = resolveAgeIdentity(params.identityPath);
    } catch (err) {
      return buildDecryptError(source, "key_resolution_failed", (err as Error).message);
    }
  }

  // Decrypt via ArtifactDecryptor — handles age and KMS uniformly. The
  // decryptor returns nested namespace → key → value; the envelope CLI
  // surfaces a flat `<namespace>__<key>` view, matching the debugger UI.
  let values: Record<string, string>;
  try {
    const decryptor = new ArtifactDecryptor({ privateKey });
    const decrypted = await decryptor.decrypt(artifact);
    values = {};
    for (const [ns, bucket] of Object.entries(decrypted.values)) {
      for (const [k, v] of Object.entries(bucket)) {
        values[`${ns}__${k}`] = v;
      }
    }
  } catch (err) {
    return buildDecryptError(source, "decrypt_failed", (err as Error).message);
  }

  const keys = Object.keys(values);

  if (params.singleKey) {
    if (!(params.singleKey in values)) {
      return buildDecryptError(
        source,
        "unknown_key",
        `key "${params.singleKey}" not present in decrypted payload`,
      );
    }
    return buildDecryptResult(source, {
      keys,
      singleKey: { name: params.singleKey, value: values[params.singleKey] },
    });
  }

  if (params.revealAll) {
    return buildDecryptResult(source, { keys, allValues: values });
  }
  return buildDecryptResult(source, { keys });
}

/**
 * Resolve an age private key per documented precedence:
 *   1. --identity <path>
 *   2. $CLEF_AGE_KEY_FILE
 *   3. $CLEF_AGE_KEY
 */
function resolveAgeIdentity(identityPath?: string): string {
  const ageDecryptor = new AgeDecryptor();

  if (identityPath) {
    return ageDecryptor.resolveKey(undefined, identityPath);
  }

  const envFile = process.env.CLEF_AGE_KEY_FILE;
  if (envFile) {
    return ageDecryptor.resolveKey(undefined, envFile);
  }

  const envInline = process.env.CLEF_AGE_KEY;
  if (envInline) {
    return ageDecryptor.resolveKey(envInline);
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
    case "unknown_key":
      return 4;
    default:
      return 1;
  }
}
