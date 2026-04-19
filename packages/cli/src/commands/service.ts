import * as path from "path";
import { Command } from "commander";
import {
  EncryptionBackend,
  GitIntegration,
  ManifestParser,
  SubprocessRunner,
  MatrixManager,
  ServiceIdentityManager,
  TransactionManager,
  keyPreview,
  isKmsEnvelope,
  VALID_KMS_PROVIDERS,
} from "@clef-sh/core";
import { handleCommandError } from "../handle-error";
import type { KmsConfig, KmsProviderType } from "@clef-sh/core";
import { formatter, isJsonMode } from "../output/formatter";
import { sym } from "../output/symbols";
import { createSopsClient } from "../age-credential";
import { copyToClipboard, maskedPlaceholder } from "../clipboard";

/** Build a ServiceIdentityManager with a TransactionManager wired up. */
function makeServiceIdManager(
  sopsClient: EncryptionBackend,
  matrixManager: MatrixManager,
  runner: SubprocessRunner,
): ServiceIdentityManager {
  const tx = new TransactionManager(new GitIntegration(runner));
  return new ServiceIdentityManager(sopsClient, matrixManager, tx);
}

export function registerServiceCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  const serviceCmd = program
    .command("service")
    .description("Manage service identities for serverless/machine workloads.");

  // --- create ---
  serviceCmd
    .command("create <name>")
    .description(
      "Create a new service identity with per-environment age key pairs or KMS envelope encryption.",
    )
    .requiredOption("--namespaces <ns>", "Comma-separated list of namespace scopes")
    .option("--description <desc>", "Human-readable description", "")
    .option(
      "--kms-env <mapping>",
      "KMS envelope encryption for an environment: env=provider:keyId (repeatable)",
      (val: string, acc: string[]) => {
        acc.push(val);
        return acc;
      },
      [] as string[],
    )
    .option(
      "--shared-recipient",
      "Generate one age key pair shared across all environments instead of one per environment",
    )
    .option(
      "--runtime",
      "Create a runtime identity (artifact-only). Keys are NOT registered on encrypted files.",
    )
    .action(
      async (
        name: string,
        opts: {
          namespaces: string;
          description: string;
          kmsEnv: string[];
          sharedRecipient?: boolean;
          runtime?: boolean;
        },
      ) => {
        try {
          const repoRoot = (program.opts().dir as string) || process.cwd();
          const parser = new ManifestParser();
          const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

          const namespaces = opts.namespaces.split(",").map((s) => s.trim());

          const kmsEnvConfigs =
            opts.kmsEnv.length > 0 ? parseKmsEnvMappings(opts.kmsEnv) : undefined;

          const hasAgeEnvs =
            !kmsEnvConfigs || manifest.environments.some((e) => !kmsEnvConfigs![e.name]);

          const isRuntime = opts.runtime === true;

          // Smart defaults: CI → shared-recipient, Runtime → per-env.
          // --shared-recipient explicitly overrides to true. When omitted,
          // use the role-based default: CI = shared, Runtime = per-env.
          const sharedRecipient = opts.sharedRecipient === true ? true : !isRuntime;

          // Runtime SIs don't touch SOPS files — skip protected-env confirmation.
          const protectedEnvs = manifest.environments.filter((e) => e.protected).map((e) => e.name);

          if (!isRuntime && protectedEnvs.length > 0 && hasAgeEnvs) {
            const confirmed = await formatter.confirm(
              `This will register recipients in protected environment(s): ${protectedEnvs.join(", ")}. Continue?`,
            );
            if (!confirmed) {
              formatter.error("Aborted.");
              process.exit(1);
              return;
            }
          }

          const matrixManager = new MatrixManager();
          const { client: sopsClient, cleanup } = await createSopsClient(
            repoRoot,
            deps.runner,
            manifest,
          );
          try {
            const manager = makeServiceIdManager(sopsClient, matrixManager, deps.runner);

            formatter.print(`${sym("working")}  Creating service identity '${name}'...`);

            const result = await manager.create(
              name,
              namespaces,
              opts.description || name,
              manifest,
              repoRoot,
              {
                kmsEnvConfigs,
                sharedRecipient,
                packOnly: isRuntime,
              },
            );

            if (isJsonMode()) {
              formatter.json({
                action: "created",
                identity: result.identity.name,
                namespaces: result.identity.namespaces,
                environments: Object.keys(result.identity.environments),
                privateKeys: result.privateKeys,
                sharedRecipient: result.sharedRecipient,
                packOnly: result.identity.pack_only ?? false,
              });
              return;
            }

            formatter.success(`Service identity '${name}' created.`);
            formatter.print(`\n  Namespaces: ${result.identity.namespaces.join(", ")}`);
            formatter.print(
              `  Environments: ${Object.keys(result.identity.environments).join(", ")}`,
            );
            if (isRuntime) {
              formatter.print("  Mode: runtime (keys are not registered on encrypted files)\n");
            } else {
              formatter.print("  Mode: CI (keys registered on encrypted files)\n");
            }

            if (Object.keys(result.privateKeys).length > 0) {
              if (result.sharedRecipient) {
                // All age envs share the same private key — display it once.
                const sharedKey = Object.values(result.privateKeys)[0];
                const ageEnvs = Object.keys(result.privateKeys).join(", ");
                const block = sharedKey;
                const copied = copyToClipboard(block);

                if (copied) {
                  formatter.warn(
                    `Shared private key copied to clipboard. It decrypts: ${ageEnvs}. Store it securely.\n`,
                  );
                  formatter.print(`  CLEF_AGE_KEY: ${maskedPlaceholder()}`);
                  formatter.print("");
                } else {
                  formatter.warn(
                    `Shared private key shown ONCE. It decrypts: ${ageEnvs}. Store it securely.\n`,
                  );
                  formatter.print(`  CLEF_AGE_KEY:`);
                  formatter.print(`    ${sharedKey}\n`);
                }
              } else {
                const entries = Object.entries(result.privateKeys);
                const block = entries.map(([env, key]) => `${env}: ${key}`).join("\n");
                const copied = copyToClipboard(block);

                if (copied) {
                  formatter.warn("Private keys copied to clipboard. Store them securely.\n");
                  for (const [envName] of entries) {
                    formatter.print(`  ${envName}: ${maskedPlaceholder()}`);
                  }
                  formatter.print("");
                } else {
                  formatter.warn(
                    "Private keys are shown ONCE. Store them securely (e.g. AWS Secrets Manager, Vault).\n",
                  );
                  for (const [envName, privateKey] of entries) {
                    formatter.print(`  ${envName}:`);
                    formatter.print(`    ${privateKey}\n`);
                  }
                }
              }
              for (const k of Object.keys(result.privateKeys)) result.privateKeys[k] = "";
            }

            // Report KMS environments
            for (const [envName, envConfig] of Object.entries(result.identity.environments)) {
              if (isKmsEnvelope(envConfig)) {
                formatter.print(
                  `  ${envName}: KMS envelope (${envConfig.kms.provider}) — no age keys generated.`,
                );
              }
            }
          } finally {
            await cleanup();
          }
        } catch (err) {
          handleCommandError(err);
        }
      },
    );

  // --- list ---
  serviceCmd
    .command("list")
    .description("List all service identities.")
    .action(async () => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        const matrixManager = new MatrixManager();
        const { client: sopsClient, cleanup } = await createSopsClient(
          repoRoot,
          deps.runner,
          manifest,
        );
        try {
          const manager = makeServiceIdManager(sopsClient, matrixManager, deps.runner);

          const identities = manager.list(manifest);

          if (isJsonMode()) {
            formatter.json(identities);
            return;
          }

          if (identities.length === 0) {
            formatter.info("No service identities configured.");
            return;
          }

          const rows = identities.map((si) => {
            const envStr = Object.entries(si.environments)
              .map(([e, cfg]) =>
                isKmsEnvelope(cfg)
                  ? `${e}: KMS (${cfg.kms.provider})`
                  : `${e}: ${keyPreview(cfg.recipient!)}`,
              )
              .join(", ");
            const nameCol = si.pack_only ? `${si.name} (runtime)` : si.name;
            return [nameCol, si.namespaces.join(", "), envStr];
          });

          formatter.table(rows, ["Name", "Namespaces", "Environments"]);
        } finally {
          await cleanup();
        }
      } catch (err) {
        handleCommandError(err);
      }
    });

  // --- show ---
  serviceCmd
    .command("show <name>")
    .description("Show details of a service identity.")
    .action(async (name: string) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        const matrixManager = new MatrixManager();
        const { client: sopsClient, cleanup } = await createSopsClient(
          repoRoot,
          deps.runner,
          manifest,
        );
        try {
          const manager = makeServiceIdManager(sopsClient, matrixManager, deps.runner);

          const identity = manager.get(manifest, name);
          if (!identity) {
            formatter.error(`Service identity '${name}' not found.`);
            process.exit(1);
            return;
          }

          if (isJsonMode()) {
            formatter.json(identity);
            return;
          }

          formatter.print(`\nService Identity: ${identity.name}`);
          formatter.print(`Description: ${identity.description}`);
          if (identity.pack_only) {
            formatter.print("Mode: runtime (not registered on encrypted files)");
          }
          formatter.print(`Namespaces: ${identity.namespaces.join(", ")}\n`);

          for (const [envName, envConfig] of Object.entries(identity.environments)) {
            if (isKmsEnvelope(envConfig)) {
              formatter.print(
                `  ${envName}: KMS (${envConfig.kms.provider}) — ${envConfig.kms.keyId}`,
              );
            } else {
              formatter.print(`  ${envName}: ${keyPreview(envConfig.recipient!)}`);
            }
          }
          formatter.print("");
        } finally {
          await cleanup();
        }
      } catch (err) {
        handleCommandError(err);
      }
    });

  // --- validate ---
  serviceCmd
    .command("validate")
    .description("Validate service identity configurations and report drift issues.")
    .action(async () => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        const matrixManager = new MatrixManager();
        const { client: sopsClient, cleanup } = await createSopsClient(
          repoRoot,
          deps.runner,
          manifest,
        );
        try {
          const manager = makeServiceIdManager(sopsClient, matrixManager, deps.runner);

          const issues = await manager.validate(manifest, repoRoot);

          if (isJsonMode()) {
            formatter.json({ issues });
            process.exit(issues.length > 0 ? 1 : 0);
            return;
          }

          if (issues.length === 0) {
            formatter.success("All service identities are valid.");
            return;
          }

          for (const issue of issues) {
            const prefix =
              issue.type === "namespace_not_found" || issue.type === "missing_environment"
                ? sym("failure")
                : sym("warning");
            formatter.print(`  ${prefix} [${issue.type}] ${issue.message}`);
            if (issue.fixCommand) {
              formatter.print(`    fix: ${issue.fixCommand}`);
            }
          }

          const errorCount = issues.filter(
            (i) => i.type === "namespace_not_found" || i.type === "missing_environment",
          ).length;
          const warnCount = issues.length - errorCount;

          formatter.print("");
          if (errorCount > 0) {
            formatter.error(`${errorCount} error(s), ${warnCount} warning(s)`);
            process.exit(1);
          } else {
            formatter.warn(`${warnCount} warning(s)`);
          }
        } finally {
          await cleanup();
        }
      } catch (err) {
        handleCommandError(err);
      }
    });

  // --- update ---
  serviceCmd
    .command("update <name>")
    .description("Update an existing service identity's environment backends.")
    .option(
      "--kms-env <mapping>",
      "Switch an environment to KMS envelope encryption: env=provider:keyId (repeatable)",
      (val: string, acc: string[]) => {
        acc.push(val);
        return acc;
      },
      [] as string[],
    )
    .action(async (name: string, opts: { kmsEnv: string[] }) => {
      try {
        if (opts.kmsEnv.length === 0) {
          formatter.error("Nothing to update. Provide --kms-env to change environment backends.");
          process.exit(1);
          return;
        }

        const repoRoot = (program.opts().dir as string) || process.cwd();
        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        const kmsEnvConfigs = parseKmsEnvMappings(opts.kmsEnv);

        const matrixManager = new MatrixManager();
        const { client: sopsClient, cleanup } = await createSopsClient(
          repoRoot,
          deps.runner,
          manifest,
        );
        try {
          const manager = makeServiceIdManager(sopsClient, matrixManager, deps.runner);

          formatter.print(`${sym("working")}  Updating service identity '${name}'...`);

          await manager.updateEnvironments(name, kmsEnvConfigs, manifest, repoRoot);

          if (isJsonMode()) {
            formatter.json({
              action: "updated",
              identity: name,
              changed: Object.entries(kmsEnvConfigs).map(([env, cfg]) => ({
                environment: env,
                provider: cfg.provider,
              })),
            });
            return;
          }

          formatter.success(`Service identity '${name}' updated.`);
          for (const [envName, kmsConfig] of Object.entries(kmsEnvConfigs)) {
            formatter.print(`  ${envName}: switched to KMS envelope (${kmsConfig.provider})`);
          }
        } finally {
          await cleanup();
        }
      } catch (err) {
        handleCommandError(err);
      }
    });

  // --- add-env ---
  serviceCmd
    .command("add-env <name> <environment>")
    .description(
      "Add an environment to an existing service identity. Generates a fresh " +
        "age key by default and registers its recipient on every cell in the SI's " +
        "scoped namespaces × this environment. Use --kms <provider:keyId> to back " +
        "the new env with KMS instead.\n\n" +
        "This is the explicit follow-up to `clef env add`, which deliberately " +
        "leaves existing service identities unchanged. Run `clef lint` after " +
        "`clef env add` to discover which service identities still need to be " +
        "extended to the new environment.",
    )
    .option(
      "--kms <provider:keyId>",
      "Use KMS envelope encryption for the new env instead of age (e.g. aws:arn:aws:kms:us-east-1:123:key/abc)",
    )
    .action(async (name: string, environment: string, opts: { kms?: string }) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        // Confirm if the target env is protected — adding an SI to production
        // is the kind of action that should not happen accidentally.
        const env = manifest.environments.find((e) => e.name === environment);
        if (env?.protected) {
          const confirmed = await formatter.confirm(
            `'${environment}' is a protected environment. Add service identity '${name}' to it?`,
          );
          if (!confirmed) {
            formatter.error("Aborted.");
            process.exit(1);
            return;
          }
        }

        let kmsConfig: KmsConfig | undefined;
        if (opts.kms) {
          const colonIdx = opts.kms.indexOf(":");
          if (colonIdx === -1) {
            formatter.error(
              `Invalid --kms format: '${opts.kms}'. Expected: provider:keyId (e.g. aws:arn:aws:kms:...)`,
            );
            process.exit(2);
            return;
          }
          const provider = opts.kms.slice(0, colonIdx) as KmsProviderType;
          const keyId = opts.kms.slice(colonIdx + 1);
          if (!VALID_KMS_PROVIDERS.includes(provider)) {
            formatter.error(
              `Invalid KMS provider '${provider}'. Valid: ${VALID_KMS_PROVIDERS.join(", ")}`,
            );
            process.exit(2);
            return;
          }
          kmsConfig = { provider, keyId };
        }

        const matrixManager = new MatrixManager();
        const { client: sopsClient, cleanup } = await createSopsClient(
          repoRoot,
          deps.runner,
          manifest,
        );
        try {
          const manager = makeServiceIdManager(sopsClient, matrixManager, deps.runner);

          formatter.print(
            `${sym("working")}  Adding ${environment} to service identity '${name}'...`,
          );
          const result = await manager.addEnvironmentToScope(
            name,
            environment,
            manifest,
            repoRoot,
            kmsConfig,
          );

          if (isJsonMode()) {
            formatter.json({
              action: "env-added",
              identity: name,
              environment,
              backend: kmsConfig ? "kms" : "age",
              ...(result.privateKey ? { privateKey: result.privateKey } : {}),
            });
            if (result.privateKey) result.privateKey = "";
            return;
          }

          formatter.success(`Added '${environment}' to service identity '${name}'.`);

          if (result.privateKey) {
            const block = `${environment}: ${result.privateKey}`;
            let copied = false;
            try {
              copied = copyToClipboard(block);
            } catch {
              // Clipboard unavailable — fall through to printing
            }

            if (copied) {
              formatter.warn(
                "New private key copied to clipboard. Store it securely — it will not be shown again.\n",
              );
              formatter.print(`  ${environment}: ${maskedPlaceholder()}`);
              formatter.print("");
            } else {
              formatter.warn("New private key shown ONCE. Store it securely.\n");
              formatter.print(`  ${environment}:`);
              formatter.print(`    ${result.privateKey}\n`);
            }
            // Clear the secret from memory so it doesn't linger in the result object
            result.privateKey = "";
          } else {
            formatter.print(`  ${environment}: KMS envelope (${kmsConfig!.provider})`);
          }
        } finally {
          await cleanup();
        }
      } catch (err) {
        handleCommandError(err);
      }
    });

  // --- delete ---
  serviceCmd
    .command("delete <name>")
    .description("Delete a service identity and remove its recipients from scoped files.")
    .action(async (name: string) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        const identity = manifest.service_identities?.find((si) => si.name === name);
        if (!identity) {
          formatter.error(`Service identity '${name}' not found.`);
          process.exit(1);
          return;
        }

        const confirmed = await formatter.confirm(
          `Delete service identity '${name}'? This will remove its recipients from all scoped files.`,
        );
        if (!confirmed) {
          formatter.error("Aborted.");
          process.exit(1);
          return;
        }

        const matrixManager = new MatrixManager();
        const { client: sopsClient, cleanup } = await createSopsClient(
          repoRoot,
          deps.runner,
          manifest,
        );
        try {
          const manager = makeServiceIdManager(sopsClient, matrixManager, deps.runner);

          formatter.print(`${sym("working")}  Deleting service identity '${name}'...`);

          await manager.delete(name, manifest, repoRoot);

          if (isJsonMode()) {
            formatter.json({ action: "deleted", identity: name });
            return;
          }
          formatter.success(`Service identity '${name}' deleted.`);
        } finally {
          await cleanup();
        }
      } catch (err) {
        handleCommandError(err);
      }
    });

  // --- rotate ---
  serviceCmd
    .command("rotate <name>")
    .description("Rotate the age key for a service identity.")
    .option("-e, --environment <env>", "Rotate only a specific environment")
    .action(async (name: string, opts: { environment?: string }) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        const matrixManager = new MatrixManager();
        const { client: sopsClient, cleanup } = await createSopsClient(
          repoRoot,
          deps.runner,
          manifest,
        );
        try {
          const manager = makeServiceIdManager(sopsClient, matrixManager, deps.runner);

          // Check for protected environments
          const identity = manager.get(manifest, name);
          if (!identity) {
            formatter.error(`Service identity '${name}' not found.`);
            process.exit(1);
            return;
          }

          const envsToRotate = opts.environment
            ? [opts.environment]
            : Object.keys(identity.environments);
          const protectedEnvs = manifest.environments
            .filter((e) => e.protected && envsToRotate.includes(e.name))
            .map((e) => e.name);

          if (protectedEnvs.length > 0) {
            const confirmed = await formatter.confirm(
              `This will rotate keys in protected environment(s): ${protectedEnvs.join(", ")}. Continue?`,
            );
            if (!confirmed) {
              formatter.error("Aborted.");
              process.exit(1);
              return;
            }
          }

          formatter.print(`${sym("working")}  Rotating key for '${name}'...`);

          const newKeys = await manager.rotateKey(name, manifest, repoRoot, opts.environment);

          if (isJsonMode()) {
            formatter.json({
              action: "rotated",
              identity: name,
              environments: Object.keys(newKeys),
              privateKeys: newKeys,
            });
            return;
          }

          formatter.success(`Key rotated for '${name}'.`);

          const entries = Object.entries(newKeys);
          const block = entries.map(([env, key]) => `${env}: ${key}`).join("\n");
          const copied = copyToClipboard(block);

          if (copied) {
            formatter.warn("New private keys copied to clipboard. Store them securely.\n");
            for (const [envName] of entries) {
              formatter.print(`  ${envName}: ${maskedPlaceholder()}`);
            }
            formatter.print("");
          } else {
            formatter.warn("New private keys are shown ONCE. Store them securely.\n");
            for (const [envName, privateKey] of entries) {
              formatter.print(`  ${envName}:`);
              formatter.print(`    ${privateKey}\n`);
            }
          }
          for (const k of Object.keys(newKeys)) newKeys[k] = "";
        } finally {
          await cleanup();
        }
      } catch (err) {
        handleCommandError(err);
      }
    });
}

function parseKmsEnvMappings(mappings: string[]): Record<string, KmsConfig> {
  const configs: Record<string, KmsConfig> = {};
  for (const mapping of mappings) {
    const eqIdx = mapping.indexOf("=");
    if (eqIdx === -1) {
      throw new Error(`Invalid --kms-env format: '${mapping}'. Expected: env=provider:keyId`);
    }
    const envName = mapping.slice(0, eqIdx);
    const rest = mapping.slice(eqIdx + 1);
    const colonIdx = rest.indexOf(":");
    if (colonIdx === -1) {
      throw new Error(`Invalid --kms-env format: '${mapping}'. Expected: env=provider:keyId`);
    }
    const provider = rest.slice(0, colonIdx);
    const keyId = rest.slice(colonIdx + 1);
    if (!VALID_KMS_PROVIDERS.includes(provider as KmsProviderType)) {
      throw new Error(
        `Invalid KMS provider '${provider}'. Must be one of: ${VALID_KMS_PROVIDERS.join(", ")}.`,
      );
    }
    if (configs[envName]) {
      throw new Error(`Duplicate --kms-env for environment '${envName}'.`);
    }
    configs[envName] = { provider: provider as KmsProviderType, keyId };
  }
  return configs;
}
