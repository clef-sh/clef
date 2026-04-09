import * as path from "path";
import { Command } from "commander";
import {
  ManifestParser,
  SubprocessRunner,
  MatrixManager,
  ArtifactPacker,
  MemoryPackOutput,
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
    .option("--remote", "Send encrypted files to Cloud for packing and serving")
    .option("--push", "Pack locally and upload artifact to Cloud for serving")
    .action(
      async (
        identity: string,
        environment: string,
        opts: {
          output?: string;
          ttl?: string;
          signingKey?: string;
          signingKmsKey?: string;
          remote?: boolean;
          push?: boolean;
        },
      ) => {
        try {
          if (opts.remote && opts.push) {
            formatter.error("Cannot specify both --remote and --push.");
            process.exit(1);
            return;
          }
          if (!opts.remote && !opts.push && !opts.output) {
            formatter.error(
              "--output is required for local pack. Use --push for Cloud or --remote for remote packing.",
            );
            process.exit(1);
            return;
          }

          const repoRoot = (program.opts().dir as string) || process.cwd();
          const parser = new ManifestParser();
          const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

          // --remote: send to Cloud for packing
          if (opts.remote) {
            const { resolveAccessToken, CloudPackClient } = await import("@clef-sh/cloud");
            const { accessToken: token, endpoint } = await resolveAccessToken();
            const ttl = opts.ttl ? parseInt(opts.ttl, 10) : undefined;
            formatter.print(`${sym("working")}  Sending to Cloud for packing...`);
            const packClient = new CloudPackClient(endpoint);
            const remoteResult = await packClient.pack(token, {
              identity,
              environment,
              manifest,
              repoRoot,
              ttl,
            });
            formatter.success(`Artifact packed by Cloud: revision ${remoteResult.revision}`);
            return;
          }

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

          // Use MemoryPackOutput for --push (no unnecessary disk round-trip).
          // If --output is also set, write the file separately.
          const memOutput = opts.push ? new MemoryPackOutput() : undefined;
          const output = memOutput ?? (outputPath ? new FilePackOutput(outputPath) : undefined);

          formatter.print(
            `${sym("working")}  Packing artifact for '${identity}/${environment}'...`,
          );

          const result = await packer.pack(
            { identity, environment, outputPath, ttl, signingKey, signingKmsKeyId, output },
            manifest,
            repoRoot,
          );

          // If --push with --output, also write the file
          if (opts.push && outputPath && memOutput?.json) {
            const fileOut = new FilePackOutput(outputPath);
            await fileOut.write(memOutput.artifact!, memOutput.json);
          }

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

          // --push: upload artifact to Cloud from memory
          if (opts.push && memOutput?.json) {
            const { resolveAccessToken, CloudArtifactClient } = await import("@clef-sh/cloud");
            const { accessToken: token, endpoint } = await resolveAccessToken();
            formatter.print(`${sym("working")}  Uploading artifact to Cloud...`);
            const artifactClient = new CloudArtifactClient(endpoint);
            await artifactClient.upload(token, {
              identity,
              environment,
              artifactJson: memOutput.json,
            });
            formatter.success("Artifact uploaded to Cloud for serving.");
          } else if (!opts.push) {
            formatter.hint(
              "\nUpload the artifact to an HTTP-accessible store (S3, GCS, etc.) or commit to\n" +
                "  .clef/packed/ for VCS-based delivery. See: clef.sh/guide/service-identities",
            );
          }
        } catch (err) {
          handleCommandError(err);
        }
      },
    );
}
