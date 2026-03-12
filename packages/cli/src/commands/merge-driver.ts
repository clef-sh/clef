import * as fs from "fs";
import * as path from "path";
import * as YAML from "yaml";
import { Command } from "commander";
import {
  ClefLocalConfig,
  ClefManifest,
  ManifestParser,
  SopsMergeDriver,
  SopsClient,
  SubprocessRunner,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";

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
  return process.cwd();
}

/**
 * Resolve the age key file path from environment or .clef/config.yaml.
 */
function resolveAgeKeyFile(repoRoot: string): string | undefined {
  if (process.env.SOPS_AGE_KEY_FILE) return process.env.SOPS_AGE_KEY_FILE;
  if (process.env.SOPS_AGE_KEY) return undefined; // inline key, no file needed

  const configPath = path.join(repoRoot, ".clef", "config.yaml");
  if (fs.existsSync(configPath)) {
    try {
      const config = YAML.parse(fs.readFileSync(configPath, "utf-8")) as ClefLocalConfig;
      if (config?.age_key_file) return config.age_key_file;
    } catch {
      // ignore parse errors
    }
  }

  return undefined;
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
        const repoRoot = (program.opts().repo as string) || findRepoRoot(oursPath);
        const ageKeyFile = resolveAgeKeyFile(repoRoot);
        const sopsClient = new SopsClient(deps.runner, ageKeyFile);
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

            // Try to determine the environment from the file path
            for (const env of manifest.environments) {
              if (oursPath.includes(env.name)) {
                environment = env.name;
                break;
              }
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
            formatter.print(`  ${c.key}:`);
            formatter.print(`    base:   ${c.baseValue ?? "(absent)"}`);
            formatter.print(`    ours:   ${c.oursValue ?? "(deleted)"}`);
            formatter.print(`    theirs: ${c.theirsValue ?? "(deleted)"}`);
          }

          formatter.hint(
            "Resolve conflicts manually with: clef set <namespace>/<env> <KEY> <value>",
          );

          // Exit 1 signals git that the merge has unresolved conflicts
          process.exit(1);
        }
      } catch (err) {
        formatter.error(`Merge driver failed: ${(err as Error).message}`);
        process.exit(1);
      }
    });
}
