import type { Command } from "commander";
import { InvalidArtifactError, assertPackedArtifact, computeCiphertextHash } from "@clef-sh/core";
import type { ArtifactSource } from "@clef-sh/runtime";
import { formatter, isJsonMode } from "../../output/formatter";
import { resolveSource } from "./source";
import {
  type InspectResult,
  buildInspectError,
  buildInspectResult,
  renderInspectHuman,
} from "./format";

/**
 * Register `clef envelope inspect` under the parent `envelope` command.
 *
 * Exit codes:
 *   0 — every source was fetched and parsed. Hash mismatch, expiry, and
 *       revocation are REPORTED in the output but do not change the exit code.
 *       Use `clef envelope verify` to hard-fail on integrity.
 *   1 — one or more sources failed to fetch or parse.
 */
export function registerInspectCommand(parent: Command): void {
  parent
    .command("inspect <source...>")
    .description(
      "Print metadata for one or more packed artifacts. No key required.\n\n" +
        "Sources accept: file paths, s3://bucket/key, or https://... URLs.\n" +
        "Hash mismatch, expiry, and revocation are shown but do not fail the\n" +
        "command — use `clef envelope verify` to gate on them.",
    )
    .action(async (sources: string[]) => {
      const results = await Promise.all(sources.map((src) => inspectOne(src)));

      if (isJsonMode()) {
        formatter.json(results);
      } else {
        renderHumanBlocks(results);
      }

      const anyErrored = results.some((r) => r.error !== null);
      process.exit(anyErrored ? 1 : 0);
    });
}

async function inspectOne(source: string): Promise<InspectResult> {
  let artifactSource: ArtifactSource;
  try {
    artifactSource = resolveSource(source);
  } catch (err) {
    return buildInspectError(source, "source_invalid", (err as Error).message);
  }

  let raw: string;
  try {
    const result = await artifactSource.fetch();
    raw = result.raw;
  } catch (err) {
    return buildInspectError(source, "fetch_failed", (err as Error).message);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return buildInspectError(source, "parse_failed", (err as Error).message);
  }

  try {
    assertPackedArtifact(parsed);
  } catch (err) {
    const message = err instanceof InvalidArtifactError ? err.message : (err as Error).message;
    return buildInspectError(source, "invalid_artifact", message);
  }

  // After assertPackedArtifact, parsed is a valid PackedArtifact.
  const artifact = parsed as Parameters<typeof buildInspectResult>[1];
  const hashOk = computeCiphertextHash(artifact.ciphertext) === artifact.ciphertextHash;

  return buildInspectResult(source, artifact, hashOk);
}

function renderHumanBlocks(results: InspectResult[]): void {
  results.forEach((r, idx) => {
    if (results.length > 1) {
      formatter.print(`\n=== ${r.source} ===`);
    }
    if (r.error) {
      formatter.error(`${r.source}: ${r.error.code} — ${r.error.message}`);
      return;
    }
    formatter.print(renderInspectHuman(r));
    if (idx < results.length - 1 && results.length > 1) {
      formatter.print("");
    }
  });
}
