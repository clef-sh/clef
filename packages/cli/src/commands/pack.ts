import * as path from "path";
import { Command } from "commander";
import {
  ManifestParser,
  SopsMissingError,
  SopsVersionError,
  SubprocessRunner,
  MatrixManager,
  ArtifactPacker,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";
import { createSopsClient } from "../age-credential";

export function registerPackCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("pack <identity> <environment>")
    .description(
      "Pack an encrypted artifact for a service identity.\n\n" +
        "  The artifact is a JSON envelope with age-encrypted secrets that can be\n" +
        "  fetched by the Clef agent at runtime from any HTTP URL or local file.\n\n" +
        "Usage:\n" +
        "  clef pack api-gateway production --output ./artifact.json\n" +
        "  # Then upload with your CI tools:\n" +
        "  # aws s3 cp ./artifact.json s3://my-bucket/clef/api-gateway/production.json",
    )
    .requiredOption("-o, --output <path>", "Output file path for the artifact JSON")
    .action(async (identity: string, environment: string, opts: { output: string }) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        const sopsClient = await createSopsClient(repoRoot, deps.runner);
        const matrixManager = new MatrixManager();
        const packer = new ArtifactPacker(sopsClient, matrixManager);

        const outputPath = path.resolve(opts.output);

        formatter.print(`${sym("working")}  Packing artifact for '${identity}/${environment}'...`);

        const result = await packer.pack({ identity, environment, outputPath }, manifest, repoRoot);

        formatter.success(
          `Artifact packed: ${result.keyCount} keys from ${result.namespaceCount} namespace(s).`,
        );
        formatter.print(`  Output:   ${result.outputPath}`);
        formatter.print(`  Size:     ${(result.artifactSize / 1024).toFixed(1)} KB`);
        formatter.print(`  Revision: ${result.revision}`);

        formatter.warn(
          "\nThe artifact contains encrypted secrets. Do NOT commit it to version control.",
        );
        formatter.hint(
          "Upload the artifact to an HTTP-accessible store (S3, GCS, etc.) using your CI tools.",
        );
      } catch (err) {
        if (err instanceof SopsMissingError || err instanceof SopsVersionError) {
          formatter.formatDependencyError(err);
          process.exit(1);
          return;
        }
        const message = err instanceof Error ? err.message : "Pack failed";
        formatter.error(message);
        process.exit(1);
      }
    });
}
