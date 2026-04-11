import * as path from "path";
import { Command } from "commander";
import {
  BackendType,
  CLEF_MANIFEST_FILENAME,
  GitIntegration,
  ManifestParser,
  MatrixManager,
  ResetManager,
  ResetOptions,
  ResetScope,
  SchemaValidator,
  SubprocessRunner,
  TransactionManager,
  describeScope,
  validateResetScope,
} from "@clef-sh/core";
import { handleCommandError } from "../handle-error";
import { formatter, isJsonMode } from "../output/formatter";
import { sym } from "../output/symbols";
import { createSopsClient } from "../age-credential";

interface ResetFlags {
  env?: string;
  namespace?: string;
  cell?: string;
  awsKmsArn?: string;
  gcpKmsResourceId?: string;
  azureKvUrl?: string;
  pgpFingerprint?: string;
  age?: boolean;
  keys?: string;
}

/** Parse the scope flags into a single ResetScope, throwing on ambiguity. */
function resolveScope(opts: ResetFlags): ResetScope {
  const provided: ResetScope[] = [];

  if (opts.env) provided.push({ kind: "env", name: opts.env });
  if (opts.namespace) provided.push({ kind: "namespace", name: opts.namespace });
  if (opts.cell) {
    const [namespace, environment] = opts.cell.split("/");
    if (!namespace || !environment) {
      throw new Error(`Invalid --cell value '${opts.cell}'. Expected 'namespace/environment'.`);
    }
    provided.push({ kind: "cell", namespace, environment });
  }

  if (provided.length === 0) {
    throw new Error(
      "Reset requires a scope. Provide exactly one of: --env <name>, --namespace <name>, or --cell <namespace/environment>.",
    );
  }
  if (provided.length > 1) {
    throw new Error(
      "Reset accepts exactly one scope flag. Pick one of --env, --namespace, --cell.",
    );
  }

  return provided[0];
}

/** Parse the backend flags into an optional { backend, key } pair. */
function resolveBackend(opts: ResetFlags): { backend?: BackendType; key?: string } {
  const provided: { backend: BackendType; key?: string }[] = [];

  if (opts.awsKmsArn) provided.push({ backend: "awskms", key: opts.awsKmsArn });
  if (opts.gcpKmsResourceId) provided.push({ backend: "gcpkms", key: opts.gcpKmsResourceId });
  if (opts.azureKvUrl) provided.push({ backend: "azurekv", key: opts.azureKvUrl });
  if (opts.pgpFingerprint) provided.push({ backend: "pgp", key: opts.pgpFingerprint });
  if (opts.age) provided.push({ backend: "age" });

  if (provided.length === 0) return {};
  if (provided.length > 1) {
    throw new Error("Reset accepts at most one backend flag.");
  }
  return provided[0];
}

export function registerResetCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("reset")
    .description(
      "Destructively reset one or more cells by scaffolding fresh placeholders.\n\n" +
        "  For disaster recovery ONLY. Abandons the current encrypted contents\n" +
        "  and re-scaffolds the cells with random pending values (or an empty\n" +
        "  cell, or schema-derived keys). Does NOT decrypt anything — use this\n" +
        "  when decryption is impossible (lost age key, nuked KMS key).\n\n" +
        "Scope (exactly one required):\n" +
        "  --env <name>          reset every cell in an environment\n" +
        "  --namespace <name>    reset every cell in a namespace\n" +
        "  --cell <ns/env>       reset a single cell\n\n" +
        "Optional backend switch (written as per-env override in clef.yaml):\n" +
        "  --aws-kms-arn <arn>   switch to AWS KMS with this key ARN\n" +
        "  --gcp-kms-resource-id <id>\n" +
        "  --azure-kv-url <url>\n" +
        "  --pgp-fingerprint <fp>\n" +
        "  --age                 switch to age\n\n" +
        "Placeholder strategy:\n" +
        "  - namespace has schema  → every schema key is scaffolded pending\n" +
        "  - --keys k1,k2,...      → those keys are scaffolded pending\n" +
        "  - otherwise             → empty cell\n\n" +
        "Exit codes:\n" +
        "  0  reset completed successfully\n" +
        "  1  reset failed (all changes rolled back)",
    )
    .option("--env <name>", "Reset every cell in an environment")
    .option("--namespace <name>", "Reset every cell in a namespace")
    .option("--cell <ns/env>", "Reset a single namespace/environment cell")
    .option("--aws-kms-arn <arn>", "Switch affected envs to AWS KMS with this key ARN")
    .option("--gcp-kms-resource-id <id>", "Switch affected envs to GCP KMS with this resource ID")
    .option("--azure-kv-url <url>", "Switch affected envs to Azure Key Vault with this URL")
    .option("--pgp-fingerprint <fp>", "Switch affected envs to PGP with this fingerprint")
    .option("--age", "Switch affected envs to age")
    .option(
      "--keys <list>",
      "Comma-separated key names to scaffold (used when namespace has no schema)",
    )
    .action(async (opts: ResetFlags) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const scope = resolveScope(opts);
        const { backend, key } = resolveBackend(opts);

        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, CLEF_MANIFEST_FILENAME));
        const matrixManager = new MatrixManager();

        // Catch unknown env/namespace before asking the user to type "y"
        // to something destructive. ResetManager re-checks defensively.
        validateResetScope(scope, manifest);

        const explicitKeys = opts.keys
          ? opts.keys
              .split(",")
              .map((k) => k.trim())
              .filter((k) => k.length > 0)
          : undefined;

        // ── Confirmation ──────────────────────────────────────────────────
        const scopeLabel = describeScope(scope);
        formatter.print(`\n${sym("warning")}  Destructive reset:`);
        formatter.print(`   Scope:  ${scopeLabel}`);
        if (backend) {
          formatter.print(`   New backend: ${backend}${key ? ` (${key})` : ""}`);
        }
        formatter.warn(
          "This will ABANDON the current encrypted contents. Decryption will NOT be attempted.",
        );

        const confirmed = await formatter.confirm(
          `Reset ${scopeLabel}? This cannot be undone except via 'git revert'.`,
        );
        if (!confirmed) {
          formatter.info("Reset cancelled.");
          return;
        }

        // ── Wire up core ──────────────────────────────────────────────────
        // Encrypt-only SOPS client: reset never decrypts, so the age key
        // (if any) is only needed if the new backend is age and the env
        // already has age recipients. createSopsClient handles both cases.
        const sopsClient = await createSopsClient(repoRoot, deps.runner);
        const schemaValidator = new SchemaValidator();
        const tx = new TransactionManager(new GitIntegration(deps.runner));
        const manager = new ResetManager(matrixManager, sopsClient, schemaValidator, tx);

        const resetOpts: ResetOptions = {
          scope,
          backend,
          key,
          keys: explicitKeys,
        };

        const result = await manager.reset(resetOpts, manifest, repoRoot);

        if (isJsonMode()) {
          formatter.json({
            scope: scopeLabel,
            scaffoldedCells: result.scaffoldedCells,
            pendingKeysByCell: result.pendingKeysByCell,
            backendChanged: result.backendChanged,
            affectedEnvironments: result.affectedEnvironments,
          });
          return;
        }

        formatter.success(
          `Reset ${scopeLabel}: scaffolded ${result.scaffoldedCells.length} cell(s). ${sym("locked")}`,
        );
        if (result.backendChanged) {
          formatter.info(`Backend override written for: ${result.affectedEnvironments.join(", ")}`);
        }

        const pendingCells = Object.keys(result.pendingKeysByCell);
        if (pendingCells.length > 0) {
          const totalPending = Object.values(result.pendingKeysByCell).reduce(
            (sum, keys) => sum + keys.length,
            0,
          );
          formatter.info(
            `${totalPending} pending placeholder(s) across ${pendingCells.length} cell(s).`,
          );
          formatter.hint("Run 'clef set' to replace placeholders with real values.");
        } else {
          formatter.hint("Cells are empty. Run 'clef set' to populate them.");
        }
      } catch (err) {
        handleCommandError(err);
      }
    });
}
