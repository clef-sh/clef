import * as path from "path";
import * as readline from "readline";
import { Command } from "commander";
import {
  ManifestParser,
  MatrixManager,
  SopsClient,
  SopsMissingError,
  SopsVersionError,
  SubprocessRunner,
  RecipientManager,
  validateAgePublicKey,
  keyPreview,
} from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";

export function waitForEnter(message: string): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

export function registerRecipientsCommand(
  program: Command,
  deps: { runner: SubprocessRunner },
): void {
  const recipientsCmd = program
    .command("recipients")
    .description("Manage age recipients that can decrypt this repository.");

  // --- list ---
  recipientsCmd
    .command("list")
    .description("List all age recipients configured for this repository.")
    .option("-e, --environment <env>", "List recipients for a specific environment")
    .action(async (opts: { environment?: string }) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        if (opts.environment) {
          const env = manifest.environments.find((e) => e.name === opts.environment);
          if (!env) {
            formatter.error(
              `Environment '${opts.environment}' not found. Available: ${manifest.environments.map((e) => e.name).join(", ")}`,
            );
            process.exit(2);
            return;
          }
        }

        const matrixManager = new MatrixManager();
        const sopsClient = new SopsClient(deps.runner);
        const recipientManager = new RecipientManager(sopsClient, matrixManager);

        const recipients = await recipientManager.list(manifest, repoRoot, opts.environment);

        if (recipients.length === 0) {
          const scope = opts.environment ? ` for environment '${opts.environment}'` : "";
          formatter.info(`No recipients configured${scope}.`);
          return;
        }

        const count = recipients.length;
        const scope = opts.environment ? ` (${opts.environment})` : "";
        formatter.print(
          `${sym("recipient")}  ${count} recipient${count !== 1 ? "s" : ""}${scope}\n`,
        );

        for (const r of recipients) {
          formatter.recipientItem(r.label || r.preview, r.label ? r.preview : "");
        }
      } catch (err) {
        if (err instanceof SopsMissingError || err instanceof SopsVersionError) {
          formatter.formatDependencyError(err);
          process.exit(1);
          return;
        }
        formatter.error((err as Error).message);
        process.exit(1);
      }
    });

  // --- add ---
  recipientsCmd
    .command("add <key>")
    .description("Add an age recipient and re-encrypt all files in the matrix.")
    .option("--label <name>", "Human-readable label for this recipient")
    .option("-e, --environment <env>", "Scope recipient to a specific environment")
    .action(async (key: string, opts: { label?: string; environment?: string }) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();

        // Validate key format before anything else
        const validation = validateAgePublicKey(key);
        if (!validation.valid) {
          formatter.error(validation.error!);
          process.exit(2);
          return;
        }

        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        if (opts.environment) {
          const env = manifest.environments.find((e) => e.name === opts.environment);
          if (!env) {
            formatter.error(
              `Environment '${opts.environment}' not found. Available: ${manifest.environments.map((e) => e.name).join(", ")}`,
            );
            process.exit(2);
            return;
          }
        }

        const matrixManager = new MatrixManager();
        const sopsClient = new SopsClient(deps.runner);
        const recipientManager = new RecipientManager(sopsClient, matrixManager);

        // Check for duplicate before prompting
        const existing = await recipientManager.list(manifest, repoRoot, opts.environment);
        const normalizedKey = validation.key!;
        if (existing.some((r) => r.key === normalizedKey)) {
          formatter.error(`Recipient '${keyPreview(normalizedKey)}' is already present.`);
          process.exit(2);
          return;
        }

        // Count files for the confirmation message
        const allCells = matrixManager.resolveMatrix(manifest, repoRoot).filter((c) => c.exists);
        const cells = opts.environment
          ? allCells.filter((c) => c.environment === opts.environment)
          : allCells;
        const fileCount = cells.length;

        // Show confirmation prompt
        const scope = opts.environment ? ` for environment '${opts.environment}'` : "";
        formatter.print(`Add recipient to this repository${scope}?\n`);
        formatter.print(`  Key:    ${keyPreview(normalizedKey)}`);
        if (opts.label) {
          formatter.print(`  Label:  ${opts.label}`);
        }
        formatter.print(`\nThis will re-encrypt ${fileCount} files in the matrix.`);
        if (opts.environment) {
          formatter.print(
            `The new recipient will be able to decrypt '${opts.environment}' secrets.\n`,
          );
        } else {
          formatter.print("The new recipient will be able to decrypt all secrets.\n");
        }

        const confirmed = await formatter.confirm("Proceed?");
        if (!confirmed) {
          formatter.info("Aborted.");
          process.exit(0);
          return;
        }

        // Show progress
        formatter.print(`\n${sym("working")}  Re-encrypting matrix...`);

        const result = await recipientManager.add(
          normalizedKey,
          opts.label,
          manifest,
          repoRoot,
          opts.environment,
        );

        // Check for rollback (failedFiles indicates failure)
        if (result.failedFiles.length > 0) {
          const failedFile = result.failedFiles[0];
          formatter.print(
            `\n${sym("failure")} Re-encryption failed on ${path.basename(failedFile)}`,
          );
          formatter.print(`   Error: re-encryption failed`);
          formatter.print("\nRolling back...");
          formatter.print(`  ${sym("success")} clef.yaml restored`);
          formatter.print(
            `  ${sym("success")} ${result.reEncryptedFiles.length} re-encrypted files restored from backup`,
          );
          formatter.print("\nNo changes were applied. Investigate the error above and retry.");
          process.exit(1);
          return;
        }

        // Show success progress
        for (const file of result.reEncryptedFiles) {
          const relative = path.relative(repoRoot, file);
          formatter.print(`   ${sym("success")}  ${relative}`);
        }

        const label = opts.label || keyPreview(normalizedKey);
        const envSuffix = opts.environment ? ` [${opts.environment}]` : "";
        formatter.success(
          `${label} added. ${result.reEncryptedFiles.length} files re-encrypted. ${sym("locked")}`,
        );
        formatter.hint(
          `git add clef.yaml && git add -A && git commit -m "add recipient: ${label}${envSuffix}"`,
        );
      } catch (err) {
        if (err instanceof SopsMissingError || err instanceof SopsVersionError) {
          formatter.formatDependencyError(err);
          process.exit(1);
          return;
        }
        formatter.error((err as Error).message);
        process.exit(1);
      }
    });

  // --- remove ---
  recipientsCmd
    .command("remove <key>")
    .description("Remove an age recipient and re-encrypt all files in the matrix.")
    .option("-e, --environment <env>", "Scope removal to a specific environment")
    .action(async (key: string, opts: { environment?: string }) => {
      try {
        // Non-TTY check — must be interactive
        if (!process.stdin.isTTY) {
          formatter.error(
            "clef recipients remove requires interactive input.\n" +
              "Recipient management should not be automated in CI.",
          );
          process.exit(2);
          return;
        }

        const repoRoot = (program.opts().dir as string) || process.cwd();
        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

        if (opts.environment) {
          const env = manifest.environments.find((e) => e.name === opts.environment);
          if (!env) {
            formatter.error(
              `Environment '${opts.environment}' not found. Available: ${manifest.environments.map((e) => e.name).join(", ")}`,
            );
            process.exit(2);
            return;
          }
        }

        const matrixManager = new MatrixManager();
        const sopsClient = new SopsClient(deps.runner);
        const recipientManager = new RecipientManager(sopsClient, matrixManager);

        // Verify recipient exists
        const existing = await recipientManager.list(manifest, repoRoot, opts.environment);
        const trimmedKey = key.trim();
        const target = existing.find((r) => r.key === trimmedKey);
        if (!target) {
          formatter.error(`Recipient '${keyPreview(trimmedKey)}' is not in the manifest.`);
          process.exit(2);
          return;
        }

        // Mandatory re-encryption warning — cannot be bypassed
        formatter.warn(
          "Important: re-encryption is not full revocation.\n\n" +
            "   Removing a recipient re-encrypts all files so the\n" +
            "   removed key cannot decrypt future versions. However,\n" +
            "   if the removed recipient previously had access, they\n" +
            "   may have decrypted values cached locally.\n\n" +
            "   To fully revoke access, you must also rotate the\n" +
            "   secret values themselves using clef rotate.\n",
        );

        await waitForEnter("   Press Enter to continue, or Ctrl+C to cancel.\n");

        // Count files for confirmation
        const allCells = matrixManager.resolveMatrix(manifest, repoRoot).filter((c) => c.exists);
        const cells = opts.environment
          ? allCells.filter((c) => c.environment === opts.environment)
          : allCells;
        const fileCount = cells.length;
        const label = target.label || keyPreview(trimmedKey);

        // Show confirmation prompt
        const scope = opts.environment ? ` for environment '${opts.environment}'` : "";
        formatter.print(`Remove recipient from this repository${scope}?\n`);
        formatter.print(`  Key:    ${target.preview}`);
        if (target.label) {
          formatter.print(`  Label:  ${target.label}`);
        }
        formatter.print(`\nThis will re-encrypt ${fileCount} files in the matrix.`);
        formatter.print(`${label} will not be able to decrypt new versions of these files.\n`);
        formatter.warn(
          "Remember: rotate secrets after removing a recipient.\n" +
            `   Run: clef rotate <namespace>/<environment>`,
        );

        const confirmed = await formatter.confirm("\nProceed?");
        if (!confirmed) {
          formatter.info("Aborted.");
          process.exit(0);
          return;
        }

        // Show progress
        formatter.print(`\n${sym("working")}  Re-encrypting matrix...`);

        const result = await recipientManager.remove(
          trimmedKey,
          manifest,
          repoRoot,
          opts.environment,
        );

        // Check for rollback
        if (result.failedFiles.length > 0) {
          const failedFile = result.failedFiles[0];
          formatter.print(
            `\n${sym("failure")} Re-encryption failed on ${path.basename(failedFile)}`,
          );
          formatter.print(`   Error: re-encryption failed`);
          formatter.print("\nRolling back...");
          formatter.print(`  ${sym("success")} clef.yaml restored`);
          formatter.print(
            `  ${sym("success")} ${result.reEncryptedFiles.length} re-encrypted files restored from backup`,
          );
          formatter.print("\nNo changes were applied. Investigate the error above and retry.");
          process.exit(1);
          return;
        }

        // Show success progress
        for (const file of result.reEncryptedFiles) {
          const relative = path.relative(repoRoot, file);
          formatter.print(`   ${sym("success")}  ${relative}`);
        }

        formatter.success(
          `${label} removed. ${result.reEncryptedFiles.length} files re-encrypted. ${sym("locked")}`,
        );

        // Rotation reminder — scope to affected environments
        formatter.warn("Rotate secrets to complete revocation:");
        const targetEnvs = opts.environment
          ? manifest.environments.filter((e) => e.name === opts.environment)
          : manifest.environments;
        for (const ns of manifest.namespaces) {
          for (const env of targetEnvs) {
            formatter.hint(`clef rotate ${ns.name}/${env.name}`);
          }
        }
        const envSuffix = opts.environment ? ` [${opts.environment}]` : "";
        formatter.hint(
          `git add clef.yaml && git add -A && git commit -m "remove recipient: ${label}${envSuffix}"`,
        );
      } catch (err) {
        if (err instanceof SopsMissingError || err instanceof SopsVersionError) {
          formatter.formatDependencyError(err);
          process.exit(1);
          return;
        }
        formatter.error((err as Error).message);
        process.exit(1);
      }
    });
}
