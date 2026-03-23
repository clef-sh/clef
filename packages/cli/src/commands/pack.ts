import * as path from "path";
import { Command } from "commander";
import {
  ManifestParser,
  SopsMissingError,
  SopsVersionError,
  SubprocessRunner,
  MatrixManager,
  ArtifactPacker,
  isKmsEnvelope,
} from "@clef-sh/core";
import type { KmsProvider } from "@clef-sh/core";
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
    .option("--ttl <seconds>", "Artifact TTL — embeds an expiresAt timestamp in the envelope")
    .action(
      async (identity: string, environment: string, opts: { output: string; ttl?: string }) => {
        try {
          const repoRoot = (program.opts().dir as string) || process.cwd();
          const parser = new ManifestParser();
          const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

          const sopsClient = await createSopsClient(repoRoot, deps.runner);
          const matrixManager = new MatrixManager();

          // Resolve KMS provider if the identity uses envelope encryption
          let kmsProvider: KmsProvider | undefined;
          const si = manifest.service_identities?.find((s) => s.name === identity);
          const envConfig = si?.environments[environment];
          if (envConfig && isKmsEnvelope(envConfig)) {
            const { createKmsProvider } = await import("@clef-sh/runtime");
            kmsProvider = createKmsProvider(envConfig.kms.provider, {
              region: envConfig.kms.region,
            });
          }

          const packer = new ArtifactPacker(sopsClient, matrixManager, kmsProvider);

          const outputPath = path.resolve(opts.output);
          const ttl = opts.ttl ? parseInt(opts.ttl, 10) : undefined;
          if (ttl !== undefined && (isNaN(ttl) || ttl < 1)) {
            formatter.error("--ttl must be a positive integer (seconds).");
            process.exit(1);
            return;
          }

          formatter.print(
            `${sym("working")}  Packing artifact for '${identity}/${environment}'...`,
          );

          const result = await packer.pack(
            { identity, environment, outputPath, ttl },
            manifest,
            repoRoot,
          );

          formatter.success(
            `Artifact packed: ${result.keyCount} keys from ${result.namespaceCount} namespace(s).`,
          );
          formatter.print(`  Output:   ${result.outputPath}`);
          formatter.print(`  Size:     ${(result.artifactSize / 1024).toFixed(1)} KB`);
          formatter.print(`  Revision: ${result.revision}`);

          if (envConfig && isKmsEnvelope(envConfig)) {
            formatter.print(`  Envelope: KMS (${envConfig.kms.provider})`);
          }

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
      },
    );
}
