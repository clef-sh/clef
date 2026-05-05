import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import {
  ClefManifest,
  ClefError,
  ManifestParser,
  SopsMergeDriver,
  SopsClient,
  SopsDecryptionError,
  SopsMissingError,
  SubprocessRunner,
  mergeMetadataFiles,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { resolveAgeCredential, prepareSopsClientArgs } from "../age-credential";

/**
 * Locate the repo root by walking up from a file path looking for clef.yaml.
 * Falls back to `git rev-parse --show-toplevel` when the upward walk fails
 * (e.g. git writes temp files to /tmp or .git/).
 */
async function findRepoRoot(filePath: string, runner?: SubprocessRunner): Promise<string> {
  try {
    let dir = path.dirname(path.resolve(filePath));
    for (let i = 0; i < 50; i++) {
      if (fs.existsSync(path.join(dir, "clef.yaml"))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // Fall through to git fallback
  }

  // Fallback: ask git for the worktree root
  if (runner) {
    try {
      const result = await runner.run("git", ["rev-parse", "--show-toplevel"]);
      if (result.exitCode === 0 && result.stdout.trim()) {
        return result.stdout.trim();
      }
    } catch {
      // Fall through to error
    }
  }

  throw new Error("Could not find clef.yaml in any parent directory of: " + filePath);
}

export function registerMergeDriverCommand(
  program: Command,
  deps: { runner: SubprocessRunner },
): void {
  program
    .command("merge-driver")
    .description(
      "SOPS-aware git merge driver. Called by git during merge conflicts on encrypted files.\n" +
        "Not typically invoked directly — configured via .gitattributes and git config.",
    )
    .argument("<base>", "Path to common ancestor file (%O)")
    .argument("<ours>", "Path to current branch file (%A)")
    .argument("<theirs>", "Path to incoming branch file (%B)")
    .action(async (basePath: string, oursPath: string, theirsPath: string) => {
      try {
        // Dispatch by file extension — the same CLI entry point serves
        // both .enc.* (SOPS-aware, decrypt/merge/re-encrypt) and
        // .clef-meta.yaml (plaintext, auto-resolving via timestamps).
        if (oursPath.endsWith(".clef-meta.yaml")) {
          try {
            mergeMetadataFiles(basePath, oursPath, theirsPath);
            process.exit(0);
            return;
          } catch (err) {
            formatter.error(`Metadata merge failed: ${(err as Error).message}. Resolve manually.`);
            process.exit(1);
            return;
          }
        }

        const repoRoot =
          (program.opts().dir as string) || (await findRepoRoot(oursPath, deps.runner));
        const credential = await resolveAgeCredential(repoRoot, deps.runner);
        const { ageKeyFile, ageKey } = prepareSopsClientArgs(credential);
        const sopsClient = new SopsClient(deps.runner, ageKeyFile, ageKey);
        const driver = new SopsMergeDriver(sopsClient);

        const result = await driver.mergeFiles(basePath, oursPath, theirsPath);

        if (result.clean) {
          // Resolve the manifest and environment for re-encryption
          const manifestPath = path.join(repoRoot, "clef.yaml");
          let manifest: ClefManifest | undefined;
          let environment: string | undefined;

          if (fs.existsSync(manifestPath)) {
            const parser = new ManifestParser();
            manifest = parser.parse(manifestPath);

            // Determine the environment by matching against resolved file patterns
            for (const ns of manifest.namespaces) {
              for (const env of manifest.environments) {
                const expected = manifest.file_pattern
                  .replace("{namespace}", ns.name)
                  .replace("{environment}", env.name);
                const resolvedOurs = path.relative(repoRoot, path.resolve(oursPath));
                if (resolvedOurs === expected) {
                  environment = env.name;
                  break;
                }
              }
              if (environment) break;
            }

            if (!environment) {
              formatter.warn(
                "Could not determine environment from file path — using default SOPS backend for re-encryption.",
              );
            }
          }

          if (manifest) {
            // encrypt(filePath) was deleted in Phase 7. Encrypt to bytes via
            // the blob surface, then write atomically — git invoked us with
            // a temp filesystem path (oursPath) that doesn't map to a clef
            // CellRef, so the source seam isn't reachable here.
            const fmt = oursPath.endsWith(".json") ? "json" : "yaml";
            const blob = await sopsClient.encrypt(result.merged, {
              manifest,
              environment,
              format: fmt,
            });
            const writeFileAtomic = (await import("write-file-atomic")).default;
            await writeFileAtomic(oursPath, blob);
          } else {
            // Fallback: write merged YAML to ours path without re-encrypting via manifest.
            // This shouldn't happen in a properly configured Clef repo.
            formatter.error("Could not find clef.yaml — cannot re-encrypt merged file.");
            process.exit(1);
            return;
          }

          // Exit 0 signals git that the merge was resolved
          process.exit(0);
        } else {
          // Report conflicts to stderr so the user can resolve them
          formatter.error(
            `Merge conflict in encrypted file: ${result.conflicts.length} key(s) conflict`,
          );

          for (const c of result.conflicts) {
            formatter.failure(`  ${c.key}:`);
            formatter.failure(`    base:   ${c.baseValue !== null ? "(has value)" : "(absent)"}`);
            formatter.failure(`    ours:   ${c.oursValue !== null ? "(has value)" : "(deleted)"}`);
            formatter.failure(
              `    theirs: ${c.theirsValue !== null ? "(has value)" : "(deleted)"}`,
            );
          }

          formatter.hint(
            "Resolve conflicts manually with: clef set <namespace>/<env> <KEY> <value>",
          );

          // Exit 1 signals git that the merge has unresolved conflicts
          process.exit(1);
        }
      } catch (err) {
        if (err instanceof SopsMissingError) {
          formatter.formatDependencyError(err);
          process.exit(1);
          return;
        }
        if (err instanceof SopsDecryptionError) {
          formatter.error(
            "Merge driver could not decrypt files. Check that your age key is available.",
          );
          process.exit(1);
          return;
        }
        if (err instanceof ClefError) {
          formatter.error(err.message);
          if (err.fix) {
            formatter.hint(err.fix);
          }
          process.exit(1);
          return;
        }
        formatter.error("Merge driver failed. Run 'clef doctor' to verify setup.");
        process.exit(1);
      }
    });
}
