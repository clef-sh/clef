import * as path from "path";
import { Command } from "commander";
import {
  BulkOps,
  ManifestParser,
  MatrixManager,
  SubprocessRunner,
  generateRandomValue,
  markPendingWithRetry,
  markResolved,
} from "@clef-sh/core";
import { handleCommandError } from "../handle-error";
import { formatter, isJsonMode } from "../output/formatter";
import { sym } from "../output/symbols";
import { createCloudAwareSopsClient } from "../cloud-sops";
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
          const { client: sopsClient, cleanup } = await createCloudAwareSopsClient(
            repoRoot,
            deps.runner,
            manifest,
          );
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

              const bulkOps = new BulkOps();
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

            const filePath = path.join(
              repoRoot,
              manifest.file_pattern
                .replace("{namespace}", namespace)
                .replace("{environment}", environment),
            );

            // Note: the CLI set command supports --random for pending placeholders.
            // The UI API (PUT /api/namespace/:ns/:env/:key) also supports { random: true }
            // but adds rollback on metadata failure. This asymmetry is intentional:
            // the CLI warns and continues, while the API must return a consistent state.
            const decrypted = await sopsClient.decrypt(filePath);
            decrypted.values[key] = secretValue;
            await sopsClient.encrypt(filePath, decrypted.values, manifest, environment);

            // Update pending metadata
            if (isPendingValue) {
              try {
                await markPendingWithRetry(filePath, [key], "clef set --random");
              } catch {
                // Roll back: remove the key and re-encrypt to avoid an orphaned
                // placeholder with no tracking metadata. Reuse the in-scope
                // decrypted values to avoid a redundant decrypt subprocess call.
                try {
                  delete decrypted.values[key];
                  await sopsClient.encrypt(filePath, decrypted.values, manifest, environment);
                } catch {
                  // Rollback failed — warn the user explicitly
                  formatter.error(
                    `${key} was encrypted but pending state could not be recorded, and rollback failed.\n` +
                      "  The encrypted file may contain an untracked random placeholder.\n" +
                      "  This key MUST be set to a real value before deploying.\n" +
                      `  Run: clef set ${namespace}/${environment} ${key}`,
                  );
                  process.exit(1);
                  return;
                }
                formatter.error(
                  `${key}: pending state could not be recorded. The value was rolled back.\n` +
                    `  Retry: clef set --random ${namespace}/${environment} ${key}`,
                );
                process.exit(1);
                return;
              }
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
              // Normal set resolves any pending state for this key
              try {
                await markResolved(filePath, [key]);
              } catch {
                formatter.warn(
                  `${key} was set but pending state could not be cleared.\n` +
                    "  The value is saved. Run clef lint to check for stale pending markers.",
                );
              }
              if (isJsonMode()) {
                formatter.json({ key, namespace, environment, action: "created", pending: false });
                return;
              }
              formatter.success(`${key} set in ${namespace}/${environment}`);
              formatter.hint(
                `Commit: git add ${manifest.file_pattern.replace("{namespace}", namespace).replace("{environment}", environment)}`,
              );
            }
          } finally {
            await cleanup();
          }
        } catch (err) {
          handleCommandError(err);
        }
      },
    );
}
