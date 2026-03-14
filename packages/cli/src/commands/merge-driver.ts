import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import {
  ClefManifest,
  ManifestParser,
  SopsMergeDriver,
  SopsClient,
  SubprocessRunner,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { resolveAgeCredential, prepareSopsClientArgs } from "../age-credential";

/**
 * Locate the repo root by walking up from a file path looking for clef.yaml.
 * Falls back to cwd if not found.
 */
function findRepoRoot(filePath: string): string {
  let dir = path.dirname(path.resolve(filePath));
  for (let i = 0; i < 50; i++) {
    if (fs.existsSync(path.join(dir, "clef.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
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
        const repoRoot = (program.opts().dir as string) || findRepoRoot(oursPath);
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
          }

          if (manifest) {
            await sopsClient.encrypt(oursPath, result.merged, manifest, environment);
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
            formatter.failure(
              `    base:   ${c.baseValue !== undefined ? "(has value)" : "(absent)"}`,
            );
            formatter.failure(
              `    ours:   ${c.oursValue !== undefined ? "(has value)" : "(deleted)"}`,
            );
            formatter.failure(
              `    theirs: ${c.theirsValue !== undefined ? "(has value)" : "(deleted)"}`,
            );
          }

          formatter.hint(
            "Resolve conflicts manually with: clef set <namespace>/<env> <KEY> <value>",
          );

          // Exit 1 signals git that the merge has unresolved conflicts
          process.exit(1);
        }
      } catch {
        formatter.error("Merge driver failed. Run 'clef doctor' to verify setup.");
        process.exit(1);
      }
    });
}
