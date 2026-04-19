import * as path from "path";
import { Command } from "commander";
import {
  GitIntegration,
  ManifestParser,
  MatrixManager,
  SubprocessRunner,
  BackendMigrator,
  MigrationTarget,
  BackendType,
  TransactionManager,
} from "@clef-sh/core";
import { handleCommandError } from "../handle-error";
import { formatter, isJsonMode } from "../output/formatter";
import { sym } from "../output/symbols";
import { createSopsClient } from "../age-credential";

interface MigrateBackendFlags {
  awsKmsArn?: string;
  gcpKmsResourceId?: string;
  azureKvUrl?: string;
  pgpFingerprint?: string;
  age?: boolean;
  environment?: string;
  dryRun?: boolean;
  skipVerify?: boolean;
}

function resolveTarget(opts: MigrateBackendFlags): MigrationTarget {
  const provided: { backend: BackendType; key?: string }[] = [];

  if (opts.awsKmsArn) provided.push({ backend: "awskms", key: opts.awsKmsArn });
  if (opts.gcpKmsResourceId) provided.push({ backend: "gcpkms", key: opts.gcpKmsResourceId });
  if (opts.azureKvUrl) provided.push({ backend: "azurekv", key: opts.azureKvUrl });
  if (opts.pgpFingerprint) provided.push({ backend: "pgp", key: opts.pgpFingerprint });
  if (opts.age) provided.push({ backend: "age" });

  if (provided.length === 0) {
    throw new Error(
      "No target backend specified. " +
        "Provide one of: --aws-kms-arn, --gcp-kms-resource-id, --azure-kv-url, --pgp-fingerprint, or --age",
    );
  }
  if (provided.length > 1) {
    throw new Error("Multiple target backends specified. Provide exactly one backend flag.");
  }

  return provided[0];
}

export function registerMigrateBackendCommand(
  program: Command,
  deps: { runner: SubprocessRunner },
): void {
  program
    .command("migrate-backend")
    .description(
      "Migrate encrypted files from one SOPS backend to another.\n\n" +
        "  Decrypts each file with the current backend, re-encrypts with\n" +
        "  the new one, and updates clef.yaml.\n\n" +
        "Exit codes:\n" +
        "  0  migration completed successfully\n" +
        "  1  migration failed (all changes rolled back)",
    )
    .option("--aws-kms-arn <arn>", "Migrate to AWS KMS with this key ARN")
    .option("--gcp-kms-resource-id <id>", "Migrate to GCP KMS with this resource ID")
    .option("--azure-kv-url <url>", "Migrate to Azure Key Vault with this URL")
    .option("--pgp-fingerprint <fp>", "Migrate to PGP with this fingerprint")
    .option("--age", "Migrate to age backend")
    .option("-e, --environment <env>", "Scope migration to a single environment")
    .option("--dry-run", "Preview changes without modifying any files")
    .option("--skip-verify", "Skip post-migration verification step")
    .action(async (opts: MigrateBackendFlags) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const target = resolveTarget(opts);

        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));
        const matrixManager = new MatrixManager();

        // Determine impacted environments
        const impactedEnvs = opts.environment
          ? manifest.environments.filter((e) => e.name === opts.environment)
          : manifest.environments;

        if (impactedEnvs.length === 0) {
          formatter.error(`Environment '${opts.environment}' not found in manifest.`);
          process.exit(1);
          return;
        }

        // Show summary and ask for confirmation
        const envNames = impactedEnvs.map((e) => e.name);
        const protectedEnvs = impactedEnvs.filter((e) => e.protected);

        formatter.print(`\n${sym("working")}  Backend migration summary:`);
        formatter.print(`   Target backend: ${target.backend}`);
        if (target.key) {
          formatter.print(`   Target key:     ${target.key}`);
        }
        formatter.print(`   Environments:   ${envNames.join(", ")}`);
        if (protectedEnvs.length > 0) {
          formatter.warn(`Protected environments: ${protectedEnvs.map((e) => e.name).join(", ")}`);
        }

        if (opts.dryRun) {
          formatter.info("Dry run — no changes will be made.\n");
        } else {
          const confirmed = await formatter.confirm(
            "This will decrypt and re-encrypt all files in the listed environments. Proceed?",
          );
          if (!confirmed) {
            formatter.info("Migration cancelled.");
            return;
          }
        }

        const { client: decryptClient, cleanup: decryptCleanup } = await createSopsClient(
          repoRoot,
          deps.runner,
          manifest,
        );
        const { client: encryptClient, cleanup: encryptCleanup } = await createSopsClient(
          repoRoot,
          deps.runner,
          manifest,
        );
        try {
          const tx = new TransactionManager(new GitIntegration(deps.runner));
          const migrator = new BackendMigrator(decryptClient, matrixManager, tx, encryptClient);

          const result = await migrator.migrate(
            manifest,
            repoRoot,
            {
              target,
              environment: opts.environment,
              dryRun: opts.dryRun,
              skipVerify: opts.skipVerify,
            },
            (event) => {
              switch (event.type) {
                case "skip":
                  formatter.info(`${sym("skipped")}  ${event.message}`);
                  break;
                case "migrate":
                  formatter.print(`${sym("working")}  ${event.message}`);
                  break;
                case "verify":
                  formatter.print(`${sym("working")}  ${event.message}`);
                  break;
                case "warn":
                  formatter.warn(event.message);
                  break;
                case "info":
                  formatter.info(event.message);
                  break;
              }
            },
          );

          if (isJsonMode()) {
            formatter.json({
              backend: target.backend,
              migratedFiles: result.migratedFiles,
              skippedFiles: result.skippedFiles,
              verifiedFiles: result.verifiedFiles,
              warnings: result.warnings,
              rolledBack: result.rolledBack,
              error: result.error ?? null,
              dryRun: opts.dryRun ?? false,
            });
            process.exit(result.rolledBack ? 1 : 0);
            return;
          }

          if (result.rolledBack) {
            formatter.error(`Migration failed: ${result.error}`);
            formatter.info("All changes have been rolled back.");
            process.exit(1);
            return;
          }

          // Report results
          if (opts.dryRun) {
            formatter.info("\nDry run complete. No files were modified.");
          } else {
            if (result.migratedFiles.length > 0) {
              formatter.success(
                `Migrated ${result.migratedFiles.length} file(s) to ${target.backend}. ${sym("locked")}`,
              );
            }
            if (result.skippedFiles.length > 0) {
              formatter.info(`Skipped ${result.skippedFiles.length} file(s) (already on target).`);
            }
            if (result.verifiedFiles.length > 0) {
              formatter.success(
                `Verified ${result.verifiedFiles.length}/${result.migratedFiles.length} file(s).`,
              );
            }
          }

          for (const warning of result.warnings) {
            formatter.warn(warning);
          }

          if (!opts.dryRun && result.migratedFiles.length > 0) {
            formatter.hint(
              'git add clef.yaml secrets/ && git commit -m "chore: migrate backend to ' +
                target.backend +
                '"',
            );
          }
        } finally {
          await decryptCleanup();
          await encryptCleanup();
        }
      } catch (err) {
        handleCommandError(err);
      }
    });
}
