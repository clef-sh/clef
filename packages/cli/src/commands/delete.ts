import * as path from "path";
import { Command } from "commander";
import {
  GitIntegration,
  ManifestParser,
  MatrixManager,
  markResolved,
  removeRotation,
  SubprocessRunner,
  TransactionManager,
} from "@clef-sh/core";
import { handleCommandError } from "../handle-error";
import { formatter, isJsonMode } from "../output/formatter";
import { createSopsClient } from "../age-credential";
import { parseTarget } from "../parse-target";

export function registerDeleteCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("delete <target> <key>")
    .description(
      "Delete a key from an encrypted file.\n\n" +
        "  target:     namespace/environment (e.g. payments/staging)\n" +
        "              or just namespace when using --all-envs\n" +
        "  key:        the key name to delete\n" +
        "  --all-envs: delete the key from all environments in the namespace\n\n" +
        "Exit codes:\n" +
        "  0  key deleted successfully\n" +
        "  1  operation failed",
    )
    .option("--all-envs", "Delete from all environments in the namespace")
    .action(async (target: string, key: string, options: { allEnvs?: boolean }) => {
      try {
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

          if (options.allEnvs) {
            // target is just the namespace
            const namespace = target.includes("/") ? target.split("/")[0] : target;

            const protectedEnvs = manifest.environments
              .filter((e) => e.protected)
              .map((e) => e.name);
            const envNames = manifest.environments.map((e) => e.name).join(", ");
            const protectedNote =
              protectedEnvs.length > 0
                ? ` including protected environments: ${protectedEnvs.join(", ")}`
                : "";
            const confirmed = await formatter.confirm(
              `This will delete '${key}' from ${manifest.environments.length} environments (${envNames})${protectedNote}. Proceed?`,
            );
            if (!confirmed) {
              formatter.info("Aborted.");
              return;
            }

            const targets = manifest.environments.map((env) => {
              const relPath = manifest.file_pattern
                .replace("{namespace}", namespace)
                .replace("{environment}", env.name);
              return {
                env: env.name,
                filePath: path.join(repoRoot, relPath),
                relPath,
              };
            });

            const tx = new TransactionManager(new GitIntegration(deps.runner));
            await tx.run(repoRoot, {
              description: `clef delete --all-envs: ${namespace}/${key}`,
              paths: targets.flatMap((t) => [
                t.relPath,
                t.relPath.replace(/\.enc\.(yaml|json)$/, ".clef-meta.yaml"),
              ]),
              mutate: async () => {
                for (const target of targets) {
                  const decrypted = await sopsClient.decrypt(target.filePath);
                  if (key in decrypted.values) {
                    delete decrypted.values[key];
                    await sopsClient.encrypt(
                      target.filePath,
                      decrypted.values,
                      manifest,
                      target.env,
                    );
                  }
                  // Strip both pending and rotation records — the key no
                  // longer exists, so stale metadata would mislead policy.
                  try {
                    await markResolved(target.filePath, [key]);
                    await removeRotation(target.filePath, [key]);
                  } catch {
                    // Non-fatal — file may not have had any metadata
                  }
                }
              },
            });
            if (isJsonMode()) {
              formatter.json({
                key,
                namespace,
                environments: manifest.environments.map((e) => e.name),
                action: "deleted",
              });
              return;
            }
            formatter.success(`Deleted '${key}' from ${namespace} in all environments`);
          } else {
            const [namespace, environment] = parseTarget(target);

            // Check for protected environment
            if (matrixManager.isProtectedEnvironment(manifest, environment)) {
              const protConfirmed = await formatter.confirm(
                `This is a protected environment (${environment}). Are you sure you want to delete '${key}'?`,
              );
              if (!protConfirmed) {
                formatter.info("Aborted.");
                return;
              }
            }

            const confirmed = await formatter.confirm(
              `Delete '${key}' from ${namespace}/${environment}?`,
            );
            if (!confirmed) {
              formatter.info("Aborted.");
              return;
            }

            const relCellPath = manifest.file_pattern
              .replace("{namespace}", namespace)
              .replace("{environment}", environment);
            const filePath = path.join(repoRoot, relCellPath);

            // Preflight the key existence check OUTSIDE the transaction so
            // we don't open a tx + lock just to error out.
            const existing = await sopsClient.decrypt(filePath);
            if (!(key in existing.values)) {
              formatter.error(`Key '${key}' not found in ${namespace}/${environment}.`);
              process.exit(1);
              return;
            }

            const tx = new TransactionManager(new GitIntegration(deps.runner));
            await tx.run(repoRoot, {
              description: `clef delete ${namespace}/${environment} ${key}`,
              paths: [relCellPath, relCellPath.replace(/\.enc\.(yaml|json)$/, ".clef-meta.yaml")],
              mutate: async () => {
                const decrypted = await sopsClient.decrypt(filePath);
                delete decrypted.values[key];
                await sopsClient.encrypt(filePath, decrypted.values, manifest, environment);
                // Strip both pending and rotation records — the key no
                // longer exists, so stale metadata would mislead policy.
                try {
                  await markResolved(filePath, [key]);
                  await removeRotation(filePath, [key]);
                } catch {
                  // Non-fatal — file may not have had any metadata
                }
              },
            });

            if (isJsonMode()) {
              formatter.json({ key, namespace, environment, action: "deleted" });
              return;
            }
            formatter.success(`Deleted '${key}' from ${namespace}/${environment}`);
          }
        } finally {
          await cleanup();
        }
      } catch (err) {
        handleCommandError(err);
      }
    });
}
