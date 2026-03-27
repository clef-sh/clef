import * as path from "path";
import { Command } from "commander";
import {
  BulkOps,
  ManifestParser,
  MatrixManager,
  markResolved,
  SubprocessRunner,
} from "@clef-sh/core";
import { handleCommandError } from "../handle-error";
import { formatter } from "../output/formatter";
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

        const sopsClient = await createSopsClient(repoRoot, deps.runner);

        const matrixManager = new MatrixManager();

        if (options.allEnvs) {
          // target is just the namespace
          const namespace = target.includes("/") ? target.split("/")[0] : target;

          const protectedEnvs = manifest.environments.filter((e) => e.protected).map((e) => e.name);
          const envNames = manifest.environments.map((e) => e.name).join(", ");
          const protectedNote =
            protectedEnvs.length > 0
              ? ` including protected environments: ${protectedEnvs.join(", ")}`
              : "";
          const confirmed = await formatter.confirm(
            `This will delete '${key}' from ${manifest.environments.length} environments (${envNames})${protectedNote}.\nType the key name to confirm:`,
          );
          if (!confirmed) {
            formatter.info("Aborted.");
            return;
          }

          const bulkOps = new BulkOps();
          await bulkOps.deleteAcrossEnvironments(namespace, key, manifest, sopsClient, repoRoot);
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

          const filePath = path.join(
            repoRoot,
            manifest.file_pattern
              .replace("{namespace}", namespace)
              .replace("{environment}", environment),
          );

          const decrypted = await sopsClient.decrypt(filePath);
          if (!(key in decrypted.values)) {
            formatter.error(`Key '${key}' not found in ${namespace}/${environment}.`);
            process.exit(1);
            return;
          }

          delete decrypted.values[key];
          await sopsClient.encrypt(filePath, decrypted.values, manifest, environment);

          // Clean up pending metadata if it exists
          try {
            await markResolved(filePath, [key]);
          } catch {
            formatter.warn(
              `Key deleted but pending metadata could not be cleaned up. Run clef lint to verify.`,
            );
          }

          formatter.success(`Deleted '${key}' from ${namespace}/${environment}`);
          formatter.hint(
            `Commit: git add ${manifest.file_pattern.replace("{namespace}", namespace).replace("{environment}", environment)}`,
          );
        }
      } catch (err) {
        handleCommandError(err);
      }
    });
}
