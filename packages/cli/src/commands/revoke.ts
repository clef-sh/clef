import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import { ManifestParser, SubprocessRunner } from "@clef-sh/core";
import { formatter, isJsonMode } from "../output/formatter";
import { sym } from "../output/symbols";

export function registerRevokeCommand(program: Command, _deps: { runner: SubprocessRunner }): void {
  program
    .command("revoke <identity> <environment>")
    .description(
      "Revoke a packed artifact for a service identity.\n\n" +
        "  Overwrites the packed artifact with a revocation marker that the\n" +
        "  Clef agent detects on the next poll, causing it to wipe its cache\n" +
        "  and stop serving secrets.\n\n" +
        "Usage:\n" +
        "  clef revoke api-gateway production\n" +
        "  # Then commit and push (or upload to your artifact store).",
    )
    .action(async (identity: string, environment: string) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        // Validate identity exists
        const si = manifest.service_identities?.find((s) => s.name === identity);
        if (!si) {
          formatter.error(
            `Service identity '${identity}' not found in manifest. ` +
              `Available: ${(manifest.service_identities ?? []).map((s) => s.name).join(", ") || "none"}`,
          );
          process.exit(1);
          return;
        }

        // Validate environment exists on identity
        if (!si.environments[environment]) {
          formatter.error(
            `Environment '${environment}' not found on identity '${identity}'. ` +
              `Available: ${Object.keys(si.environments).join(", ")}`,
          );
          process.exit(1);
          return;
        }

        const artifactDir = path.join(repoRoot, ".clef", "packed", identity);
        const artifactPath = path.join(artifactDir, `${environment}.age.json`);

        const revoked = {
          version: 1,
          identity,
          environment,
          revokedAt: new Date().toISOString(),
        };

        fs.mkdirSync(artifactDir, { recursive: true });
        fs.writeFileSync(artifactPath, JSON.stringify(revoked, null, 2) + "\n", "utf-8");

        const relPath = path.relative(repoRoot, artifactPath);

        if (isJsonMode()) {
          formatter.json({
            identity,
            environment,
            revokedAt: revoked.revokedAt,
            markerPath: relPath,
          });
          return;
        }

        formatter.success(`Artifact revoked: ${relPath}`);
        formatter.print("");
        formatter.print(`${sym("arrow")}  If your agent fetches artifacts from git (VCS source):`);
        formatter.print(`  git add ${relPath}`);
        formatter.print(`  git commit -m "revoke(${identity}): <your reason here>"`);
        formatter.print("  git push");
        formatter.print("");
        formatter.print(
          `${sym("arrow")}  If your agent fetches artifacts via HTTP (S3, GCS, etc.):`,
        );
        formatter.print(
          `  Upload ${relPath} to your artifact store, replacing the current artifact.`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Revoke failed";
        formatter.error(message);
        process.exit(1);
      }
    });
}
