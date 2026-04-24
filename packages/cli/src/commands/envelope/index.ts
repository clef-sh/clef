import type { Command } from "commander";
import type { SubprocessRunner } from "@clef-sh/core";
import { registerInspectCommand } from "./inspect";
import { registerVerifyCommand } from "./verify";

/**
 * Register `clef envelope` and its subcommands on the given program.
 *
 * The envelope debugger inspects, verifies, and (in later PRs) decrypts
 * packed artifacts produced by `clef pack`. Subcommands follow the multi-level
 * pattern used by `clef service` and `clef recipients`.
 *
 * Subcommands landing by PR:
 *   PR 2 — inspect  (this file)
 *   PR 3 — verify
 *   PR 4 — decrypt  (age path)
 *   PR 5 — decrypt  (KMS path extension)
 */
export function registerEnvelopeCommand(
  program: Command,
  _deps: { runner: SubprocessRunner },
): void {
  const envelopeCmd = program
    .command("envelope")
    .description(
      "Inspect, verify, and decrypt packed artifacts for debugging.\n\n" +
        "Exit codes (common to all subcommands where applicable):\n" +
        "  0  success\n" +
        "  1  generic error (bad args, source unreachable, parse failure)\n" +
        "  2  ciphertext hash mismatch (verify/decrypt)\n" +
        "  3  signature invalid (verify)\n" +
        "  4  key resolution failure (decrypt)\n" +
        "  5  expired or revoked (decrypt)",
    );

  registerInspectCommand(envelopeCmd);
  registerVerifyCommand(envelopeCmd);
}
