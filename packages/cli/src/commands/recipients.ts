import * as path from "path";
import * as readline from "readline";
import { Command } from "commander";
import {
  FileEncryptionBackend,
  GitIntegration,
  ManifestParser,
  MatrixManager,
  SubprocessRunner,
  RecipientManager,
  TransactionManager,
  validateAgePublicKey,
  keyPreview,
  deriveAgePublicKey,
  loadRequests,
  upsertRequest,
  removeAccessRequest,
  findRequest,
  REQUESTS_FILENAME,
} from "@clef-sh/core";
import { handleCommandError } from "../handle-error";
import type { ClefManifest } from "@clef-sh/core";
import { formatter, isJsonMode } from "../output/formatter";
import { sym } from "../output/symbols";
import { createSopsClient, resolveAgePrivateKey } from "../age-credential";

/** Build a RecipientManager with a TransactionManager wired up. */
function makeRecipientManager(
  sopsClient: FileEncryptionBackend,
  matrixManager: MatrixManager,
  runner: SubprocessRunner,
): RecipientManager {
  const tx = new TransactionManager(new GitIntegration(runner));
  return new RecipientManager(sopsClient, matrixManager, tx);
}

export function waitForEnter(message: string): Promise<void> {
  if (isJsonMode()) return Promise.resolve();
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    rl.question(message, () => {
      rl.close();
      process.stdin.pause();
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
        const { client: sopsClient, cleanup } = await createSopsClient(
          repoRoot,
          deps.runner,
          manifest,
        );
        try {
          const recipientManager = makeRecipientManager(sopsClient, matrixManager, deps.runner);

          const recipients = await recipientManager.list(manifest, repoRoot, opts.environment);

          if (isJsonMode()) {
            formatter.json(recipients);
            return;
          }

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
        } finally {
          await cleanup();
        }
      } catch (err) {
        handleCommandError(err);
      }
    });

  // --- add ---
  recipientsCmd
    .command("add <key>")
    .description(
      "Add an age recipient and re-encrypt files for a specific environment.\n\n" +
        "The -e flag is required — recipients must be added per-environment.",
    )
    .option("--label <name>", "Human-readable label for this recipient")
    .requiredOption("-e, --environment <env>", "Environment to grant access to")
    .action(async (key: string, opts: { label?: string; environment: string }) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();

        // Validate key format before anything else
        const validation = validateAgePublicKey(key);
        if (!validation.valid) {
          formatter.error(validation.error!);
          process.exit(2);
          return;
        }

        const normalizedKey = validation.key!;
        const result = await executeRecipientAdd(
          repoRoot,
          program,
          deps,
          normalizedKey,
          opts.label,
          opts.environment,
        );

        if (result) {
          if (isJsonMode()) {
            formatter.json({
              action: "added",
              key: normalizedKey,
              label: opts.label || keyPreview(normalizedKey),
              environment: opts.environment,
              reEncryptedFiles: result.reEncryptedFiles.length,
            });
          } else {
            const label = opts.label || keyPreview(normalizedKey);
            formatter.hint(
              `git add clef.yaml && git add -A && git commit -m "add recipient: ${label} [${opts.environment}]"`,
            );
          }
        }
      } catch (err) {
        handleCommandError(err);
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
        const { client: sopsClient, cleanup } = await createSopsClient(
          repoRoot,
          deps.runner,
          manifest,
        );
        try {
          const recipientManager = makeRecipientManager(sopsClient, matrixManager, deps.runner);

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

          if (isJsonMode()) {
            formatter.json({
              action: "removed",
              key: trimmedKey,
              label,
              environment: opts.environment ?? null,
              reEncryptedFiles: result.reEncryptedFiles.length,
            });
            return;
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
        } finally {
          await cleanup();
        }
      } catch (err) {
        handleCommandError(err);
      }
    });

  // --- request ---
  recipientsCmd
    .command("request")
    .description(
      "Request recipient access by publishing your public key for approval.\n\n" +
        "Writes your public key to .clef-requests.yaml so a team member can\n" +
        "approve it with: clef recipients approve <label>",
    )
    .option("--label <name>", "Human-readable label for this request")
    .option("-e, --environment <env>", "Request access to a specific environment only")
    .action(async (opts: { label?: string; environment?: string }) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();

        // Resolve private key to derive public key
        const privateKey = await resolveAgePrivateKey(repoRoot, deps.runner);
        if (!privateKey) {
          formatter.error("No age key found. Run clef init first.");
          process.exit(1);
          return;
        }

        const publicKey = await deriveAgePublicKey(privateKey);

        // Check manifest exists and validate environment
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

        // Check if already a recipient
        const matrixManager = new MatrixManager();
        const { client: sopsClient, cleanup } = await createSopsClient(
          repoRoot,
          deps.runner,
          manifest,
        );
        try {
          const recipientManager = makeRecipientManager(sopsClient, matrixManager, deps.runner);
          const existing = await recipientManager.list(manifest, repoRoot, opts.environment);
          if (existing.some((r) => r.key === publicKey)) {
            formatter.info("You are already a recipient.");
            return;
          }

          // Resolve label
          let label = opts.label;
          if (!label) {
            try {
              const result = await deps.runner.run("git", ["config", "user.name"]);
              label = result.stdout.trim();
            } catch {
              // git config may not be set
            }
          }
          if (!label) {
            formatter.error("Could not determine a label. Set git user.name or pass --label.");
            process.exit(2);
            return;
          }

          upsertRequest(repoRoot, publicKey, label, opts.environment);

          if (isJsonMode()) {
            formatter.json({
              action: "requested",
              label,
              key: publicKey,
              environment: opts.environment ?? null,
            });
            return;
          }

          const scope = opts.environment ? ` for environment '${opts.environment}'` : "";
          formatter.success(`Access requested as '${label}'${scope}`);
          formatter.print(`  Key: ${keyPreview(publicKey)}`);
          formatter.hint(
            `git add ${REQUESTS_FILENAME} && git commit -m "chore: request recipient access for ${label}" && git push`,
          );
        } finally {
          await cleanup();
        }
      } catch (err) {
        formatter.error((err as Error).message);
        process.exit(1);
      }
    });

  // --- pending ---
  recipientsCmd
    .command("pending")
    .description("List pending recipient access requests.")
    .action(async () => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const requests = loadRequests(repoRoot);

        if (isJsonMode()) {
          formatter.json(
            requests.map((r) => ({
              ...r,
              requestedAt: r.requestedAt.toISOString(),
            })),
          );
          return;
        }

        if (requests.length === 0) {
          formatter.info("No pending access requests.");
          return;
        }

        const count = requests.length;
        formatter.print(`${sym("recipient")}  ${count} pending request${count !== 1 ? "s" : ""}\n`);

        for (const r of requests) {
          const scope = r.environment ? ` [${r.environment}]` : "";
          const days = Math.floor((Date.now() - r.requestedAt.getTime()) / (1000 * 60 * 60 * 24));
          const age = days === 0 ? "today" : `${days}d ago`;
          formatter.recipientItem(`${r.label}${scope}`, `${keyPreview(r.key)}  ${age}`);
        }

        formatter.print("");
        formatter.hint("clef recipients approve <label>");
      } catch (err) {
        formatter.error((err as Error).message);
        process.exit(1);
      }
    });

  // --- approve ---
  recipientsCmd
    .command("approve <identifier>")
    .description(
      "Approve a pending recipient request and re-encrypt files for a specific environment.\n\n" +
        "The identifier can be a label or an age public key.\n" +
        "Uses the environment from the request if one was specified,\n" +
        "otherwise -e is required.",
    )
    .option("-e, --environment <env>", "Environment to grant access to (overrides request)")
    .action(async (identifier: string, opts: { environment?: string }) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();

        const request = findRequest(repoRoot, identifier);
        if (!request) {
          formatter.error(`No pending request matching '${identifier}'.`);
          process.exit(2);
          return;
        }

        const environment = opts.environment ?? request.environment;
        if (!environment) {
          formatter.error(
            "An environment is required. The request did not specify one.\n" +
              "  Use -e to specify: clef recipients approve " +
              identifier +
              " -e <environment>",
          );
          process.exit(2);
          return;
        }

        const result = await executeRecipientAdd(
          repoRoot,
          program,
          deps,
          request.key,
          request.label,
          environment,
        );

        if (result) {
          removeAccessRequest(repoRoot, identifier);
          if (isJsonMode()) {
            formatter.json({
              action: "approved",
              identifier,
              label: request.label,
              environment,
              reEncryptedFiles: result.reEncryptedFiles.length,
            });
          } else {
            formatter.hint(
              `git add clef.yaml ${REQUESTS_FILENAME} && git add -A && git commit -m "approve recipient: ${request.label} [${environment}]"`,
            );
          }
        }
      } catch (err) {
        handleCommandError(err);
      }
    });
}

/**
 * Shared logic for adding a recipient — used by both `add` and `approve`.
 * Environment is always required — recipients must be added per-environment.
 * Returns true on success, false on failure or abort.
 */
async function executeRecipientAdd(
  repoRoot: string,
  _program: Command,
  deps: { runner: SubprocessRunner },
  key: string,
  label: string | undefined,
  environment: string,
): Promise<{ reEncryptedFiles: string[] } | null> {
  const parser = new ManifestParser();
  const manifest: ClefManifest = parser.parse(path.join(repoRoot, "clef.yaml"));

  const env = manifest.environments.find((e) => e.name === environment);
  if (!env) {
    formatter.error(
      `Environment '${environment}' not found. Available: ${manifest.environments.map((e) => e.name).join(", ")}`,
    );
    process.exit(2);
    return null;
  }

  const matrixManager = new MatrixManager();
  const { client: sopsClient, cleanup } = await createSopsClient(repoRoot, deps.runner, manifest);
  try {
    const recipientManager = makeRecipientManager(sopsClient, matrixManager, deps.runner);

    // Check for duplicate
    const existing = await recipientManager.list(manifest, repoRoot, environment);
    if (existing.some((r) => r.key === key)) {
      formatter.error(`Recipient '${keyPreview(key)}' is already present.`);
      process.exit(2);
      return null;
    }

    // Count files for confirmation
    const allCells = matrixManager
      .resolveMatrix(manifest, repoRoot)
      .filter((c) => c.exists && c.environment === environment);
    const fileCount = allCells.length;

    // Show confirmation
    formatter.print(`Add recipient for environment '${environment}'?\n`);
    formatter.print(`  Key:    ${keyPreview(key)}`);
    if (label) {
      formatter.print(`  Label:  ${label}`);
    }
    formatter.print(`\nThis will re-encrypt ${fileCount} files in the matrix.`);
    formatter.print(`The new recipient will be able to decrypt '${environment}' secrets.\n`);

    const confirmed = await formatter.confirm("Proceed?");
    if (!confirmed) {
      formatter.info("Aborted.");
      return null;
    }

    formatter.print(`\n${sym("working")}  Re-encrypting matrix...`);

    const result = await recipientManager.add(key, label, manifest, repoRoot, environment);

    if (result.failedFiles.length > 0) {
      const failedFile = result.failedFiles[0];
      formatter.print(`\n${sym("failure")} Re-encryption failed on ${path.basename(failedFile)}`);
      formatter.print(`   Error: re-encryption failed`);
      formatter.print("\nRolling back...");
      formatter.print(`  ${sym("success")} clef.yaml restored`);
      formatter.print(
        `  ${sym("success")} ${result.reEncryptedFiles.length} re-encrypted files restored from backup`,
      );
      formatter.print("\nNo changes were applied. Investigate the error above and retry.");
      process.exit(1);
      return null;
    }

    for (const file of result.reEncryptedFiles) {
      const relative = path.relative(repoRoot, file);
      formatter.print(`   ${sym("success")}  ${relative}`);
    }

    const displayLabel = label || keyPreview(key);
    formatter.success(
      `${displayLabel} added. ${result.reEncryptedFiles.length} files re-encrypted. ${sym("locked")}`,
    );
    return { reEncryptedFiles: result.reEncryptedFiles };
  } finally {
    await cleanup();
  }
}
