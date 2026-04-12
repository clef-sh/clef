import * as path from "path";
import { Command } from "commander";
import {
  BulkOps,
  GitIntegration,
  ManifestParser,
  MatrixManager,
  SubprocessRunner,
  TransactionManager,
  generateRandomValue,
  markPendingWithRetry,
  markResolved,
} from "@clef-sh/core";
import { handleCommandError } from "../handle-error";
import { formatter, isJsonMode } from "../output/formatter";
import { sym } from "../output/symbols";
import { createSopsClient } from "../age-credential";
import { parseTarget } from "../parse-target";

export function registerSetCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("set <target> <key> [value]")
    .description(
      "Set a secret value. If value is omitted, prompts securely (hidden input).\n\n" +
        "  target: namespace/environment (e.g. payments/staging)\n" +
        "  key:    the key name to set\n" +
        "  value:  optional — if omitted, prompts with hidden input\n\n" +
        "The plaintext value is never written to disk or printed to stdout.\n\n" +
        "Exit codes:\n" +
        "  0  value set successfully\n" +
        "  1  operation failed",
    )
    .option(
      "--random",
      "Generate a cryptographically random placeholder value and mark the key as pending",
    )
    .option("--all-envs", "Set the key in all environments for the namespace")
    .action(
      async (
        target: string,
        key: string,
        value: string | undefined,
        opts: { random?: boolean; allEnvs?: boolean },
      ) => {
        try {
          if (opts.random && value !== undefined) {
            formatter.error(
              "Cannot use --random and provide a value simultaneously.\n" +
                "Use --random to generate a placeholder, or provide a value to set it directly.",
            );
            process.exit(1);
            return;
          }

          const repoRoot = (program.opts().dir as string) || process.cwd();
          const parser = new ManifestParser();
          const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));
          const sopsClient = await createSopsClient(repoRoot, deps.runner);
          try {
            if (opts.allEnvs) {
              const namespace = target.includes("/") ? target.split("/")[0] : target;

              const protectedEnvs = manifest.environments
                .filter((e) => e.protected)
                .map((e) => e.name);
              if (protectedEnvs.length > 0) {
                const confirmed = await formatter.confirm(
                  `This will set '${key}' in ${manifest.environments.length} environments` +
                    ` including protected: ${protectedEnvs.join(", ")}. Continue?`,
                );
                if (!confirmed) {
                  formatter.info("Aborted.");
                  return;
                }
              }

              let values: Record<string, string>;
              let allPending = false;

              if (opts.random) {
                values = Object.fromEntries(
                  manifest.environments.map((e) => [e.name, generateRandomValue()]),
                );
                allPending = true;
              } else {
                let secretValue: string;
                if (value !== undefined) {
                  formatter.warn(
                    "Secret passed as a command-line argument is visible in shell history.\n" +
                      `  Consider using the interactive prompt instead: clef set ${target} ${key} --all-envs`,
                  );
                  secretValue = value;
                } else {
                  secretValue = await formatter.secretPrompt(
                    `Enter value for ${key} (all environments)`,
                  );
                }
                values = Object.fromEntries(
                  manifest.environments.map((e) => [e.name, secretValue]),
                );
              }

              const tx = new TransactionManager(new GitIntegration(deps.runner));
              const bulkOps = new BulkOps(tx);
              await bulkOps.setAcrossEnvironments(
                namespace,
                key,
                values,
                manifest,
                sopsClient,
                repoRoot,
              );

              if (allPending) {
                const pendingErrors: string[] = [];
                for (const env of manifest.environments) {
                  const filePath = path.join(
                    repoRoot,
                    manifest.file_pattern
                      .replace("{namespace}", namespace)
                      .replace("{environment}", env.name),
                  );
                  try {
                    await markPendingWithRetry(filePath, [key], "clef set --random --all-envs");
                  } catch {
                    pendingErrors.push(env.name);
                  }
                }
                if (isJsonMode()) {
                  formatter.json({
                    key,
                    namespace,
                    environments: manifest.environments.map((e) => e.name),
                    action: "created",
                    pending: true,
                  });
                  return;
                }
                formatter.success(
                  `'${key}' set in ${namespace} across all environments ${sym("locked")}`,
                );
                formatter.print(
                  `   ${sym("pending")}  Marked as pending — replace with real values before deploying`,
                );
                if (pendingErrors.length > 0) {
                  formatter.warn(
                    `Pending metadata could not be written for: ${pendingErrors.join(", ")}`,
                  );
                }
                formatter.hint(`clef set ${namespace}/<env> ${key}  # for each environment`);
              } else {
                for (const env of manifest.environments) {
                  const filePath = path.join(
                    repoRoot,
                    manifest.file_pattern
                      .replace("{namespace}", namespace)
                      .replace("{environment}", env.name),
                  );
                  try {
                    await markResolved(filePath, [key]);
                  } catch {
                    // Non-fatal — file may not have had pending state
                  }
                }
                if (isJsonMode()) {
                  formatter.json({
                    key,
                    namespace,
                    environments: manifest.environments.map((e) => e.name),
                    action: "created",
                    pending: false,
                  });
                  return;
                }
                formatter.success(`'${key}' set in ${namespace} across all environments`);
                formatter.hint(`git add ${namespace}/  # stage all updated files`);
              }
              return;
            }

            if (value !== undefined && !opts.random) {
              formatter.warn(
                "Secret passed as a command-line argument is visible in shell history.\n" +
                  `  Consider using the interactive prompt instead: clef set ${target} ${key}`,
              );
            }

            const [namespace, environment] = parseTarget(target);

            // Check for protected environment
            const matrixManager = new MatrixManager();
            if (matrixManager.isProtectedEnvironment(manifest, environment)) {
              const confirmed = await formatter.confirm(
                `This is a protected environment (${environment}). Confirm?`,
              );
              if (!confirmed) {
                formatter.info("Aborted.");
                return;
              }
            }

            // Determine the value
            let secretValue: string;
            let isPendingValue = false;

            if (opts.random) {
              secretValue = generateRandomValue();
              isPendingValue = true;
            } else if (value === undefined) {
              secretValue = await formatter.secretPrompt(`Enter value for ${key}`);
            } else {
              secretValue = value;
            }

            const relCellPath = manifest.file_pattern
              .replace("{namespace}", namespace)
              .replace("{environment}", environment);
            const filePath = path.join(repoRoot, relCellPath);

            // Single-cell set wraps both the encrypt and the pending-metadata
            // write in one transaction. Either both land or both roll back —
            // no more "encrypted but pending tracking lost" footgun.
            const tx = new TransactionManager(new GitIntegration(deps.runner));
            await tx.run(repoRoot, {
              description: isPendingValue
                ? `clef set --random ${namespace}/${environment} ${key}`
                : `clef set ${namespace}/${environment} ${key}`,
              // Stage both the encrypted cell and its sibling pending-metadata
              // file. The metadata file may not exist yet, but git add tolerates
              // that and tx.run rolls back any new metadata file via git clean.
              paths: [relCellPath, relCellPath.replace(/\.enc\.(yaml|json)$/, ".clef-meta.yaml")],
              mutate: async () => {
                const decrypted = await sopsClient.decrypt(filePath);
                decrypted.values[key] = secretValue;
                await sopsClient.encrypt(filePath, decrypted.values, manifest, environment);

                if (isPendingValue) {
                  await markPendingWithRetry(filePath, [key], "clef set --random");
                } else {
                  // Normal set resolves any pending state for this key
                  try {
                    await markResolved(filePath, [key]);
                  } catch {
                    // Non-fatal — file may not have had pending state
                  }
                }
              },
            });

            if (isPendingValue) {
              if (isJsonMode()) {
                formatter.json({ key, namespace, environment, action: "created", pending: true });
                return;
              }
              formatter.success(`${key} set in ${namespace}/${environment} ${sym("locked")}`);
              formatter.print(
                `   ${sym("pending")}  Marked as pending \u2014 replace with a real value before deploying`,
              );
              formatter.hint(`clef set ${namespace}/${environment} ${key}`);
            } else {
              if (isJsonMode()) {
                formatter.json({ key, namespace, environment, action: "created", pending: false });
                return;
              }
              formatter.success(`${key} set in ${namespace}/${environment}`);
            }
          } finally {
            // no cleanup needed
          }
        } catch (err) {
          handleCommandError(err);
        }
      },
    );
}
