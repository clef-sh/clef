import * as path from "path";
import { Command } from "commander";
import {
  ManifestParser,
  SubprocessRunner,
  MatrixManager,
  ArtifactPacker,
  FilePackOutput,
  isKmsEnvelope,
} from "@clef-sh/core";
import { handleCommandError } from "../handle-error";
import type { KmsProvider } from "@clef-sh/core";
import { formatter, isJsonMode } from "../output/formatter";
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
    .option("-o, --output <path>", "Output file path for the artifact JSON")
    .option("--ttl <seconds>", "Artifact TTL — embeds an expiresAt timestamp in the envelope")
    .option(
      "--signing-key <key>",
      "Ed25519 private key for artifact signing (base64 DER PKCS8, or env CLEF_SIGNING_KEY)",
    )
    .option(
      "--signing-kms-key <keyId>",
      "KMS asymmetric signing key ARN/ID (ECDSA_SHA_256, or env CLEF_SIGNING_KMS_KEY)",
    )
    .action(
      async (
        identity: string,
        environment: string,
        opts: {
          output?: string;
          ttl?: string;
          signingKey?: string;
          signingKmsKey?: string;
        },
      ) => {
        try {
          if (!opts.output) {
            formatter.error("--output is required.");
            process.exit(1);
            return;
          }

          const repoRoot = (program.opts().dir as string) || process.cwd();
          const parser = new ManifestParser();
          const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

          const { client: sopsClient, cleanup } = await createSopsClient(
            repoRoot,
            deps.runner,
            manifest,
          );
          try {
            const matrixManager = new MatrixManager();

            // Resolve KMS provider if the identity uses envelope encryption
            let kmsProvider: KmsProvider | undefined;
            const si = manifest.service_identities?.find((s) => s.name === identity);
            const envConfig = si?.environments[environment];
            if (envConfig && isKmsEnvelope(envConfig)) {
              const { createKmsProvider } = await import("@clef-sh/runtime");
              kmsProvider = await createKmsProvider(envConfig.kms.provider, {
                region: envConfig.kms.region,
              });
            }

            const packer = new ArtifactPacker(sopsClient, matrixManager, kmsProvider);

            const outputPath = opts.output ? path.resolve(opts.output) : undefined;
            const ttl = opts.ttl ? parseInt(opts.ttl, 10) : undefined;
            if (ttl !== undefined && (isNaN(ttl) || ttl < 1)) {
              formatter.error("--ttl must be a positive integer (seconds).");
              process.exit(1);
              return;
            }

            // Resolve signing key: flag > env var
            const signingKey = opts.signingKey ?? process.env.CLEF_SIGNING_KEY;
            const signingKmsKeyId = opts.signingKmsKey ?? process.env.CLEF_SIGNING_KMS_KEY;

            if (signingKey && signingKmsKeyId) {
              formatter.error(
                "Cannot specify both --signing-key (Ed25519) and --signing-kms-key (KMS). Choose one.",
              );
              process.exit(1);
              return;
            }

            const output = outputPath ? new FilePackOutput(outputPath) : undefined;

            formatter.print(
              `${sym("working")}  Packing artifact for '${identity}/${environment}'...`,
            );

            const result = await packer.pack(
              { identity, environment, outputPath, ttl, signingKey, signingKmsKeyId, output },
              manifest,
              repoRoot,
            );

            if (isJsonMode()) {
              formatter.json({
                identity,
                environment,
                keyCount: result.keyCount,
                namespaceCount: result.namespaceCount,
                artifactSize: result.artifactSize,
                revision: result.revision,
                output: outputPath ?? null,
              });
              return;
            }

            formatter.success(
              `Artifact packed: ${result.keyCount} keys from ${result.namespaceCount} namespace(s).`,
            );
            if (outputPath) {
              formatter.print(`  Output:   ${outputPath}`);
            }
            formatter.print(`  Size:     ${(result.artifactSize / 1024).toFixed(1)} KB`);
            formatter.print(`  Revision: ${result.revision}`);

            if (envConfig && isKmsEnvelope(envConfig)) {
              formatter.print(`  Envelope: KMS (${envConfig.kms.provider})`);
            }

            if (signingKey) {
              formatter.print(`  Signed:   Ed25519`);
            } else if (signingKmsKeyId) {
              formatter.print(`  Signed:   KMS ECDSA_SHA256`);
            }

            formatter.hint(
              "\nUpload the artifact to an HTTP-accessible store (S3, GCS, etc.) or commit to\n" +
                "  .clef/packed/ for VCS-based delivery. See: clef.sh/guide/service-identities",
            );
          } finally {
            await cleanup();
          }
        } catch (err) {
          handleCommandError(err);
        }
      },
    );
}
