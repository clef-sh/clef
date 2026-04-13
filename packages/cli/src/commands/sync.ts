import * as path from "path";
import { Command } from "commander";
import {
  GitIntegration,
  ManifestParser,
  MatrixManager,
  SubprocessRunner,
  SyncManager,
  TransactionManager,
} from "@clef-sh/core";
import type { SyncCellPlan } from "@clef-sh/core";
import { handleCommandError } from "../handle-error";
import { formatter, isJsonMode } from "../output/formatter";
import { sym } from "../output/symbols";
import { createSopsClient } from "../age-credential";

export function registerSyncCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  program
    .command("sync [namespace]")
    .description(
      "Scaffold missing keys across environments within a namespace.\n\n" +
        "  Computes the union of all keys in a namespace, then adds any\n" +
        "  missing keys to each environment with random pending values.\n\n" +
        "  clef sync payments           sync the payments namespace\n" +
        "  clef sync --all              sync all namespaces\n" +
        "  clef sync payments --dry-run preview without changes\n\n" +
        "Exit codes:\n" +
        "  0  sync completed (or dry-run previewed)\n" +
        "  1  sync failed",
    )
    .option("--all", "Sync all namespaces")
    .option("--dry-run", "Show what would be scaffolded without making changes")
    .action(async (namespace: string | undefined, opts: { all?: boolean; dryRun?: boolean }) => {
      try {
        if (!namespace && !opts.all) {
          formatter.error(
            "Provide a namespace or use --all to sync every namespace.\n" +
              "  clef sync payments\n" +
              "  clef sync --all",
          );
          process.exit(1);
          return;
        }
        if (namespace && opts.all) {
          formatter.error("Cannot specify both a namespace and --all.");
          process.exit(1);
          return;
        }

        const repoRoot = (program.opts().dir as string) || process.cwd();
        const parser = new ManifestParser();
        const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));
        const sopsClient = await createSopsClient(repoRoot, deps.runner);
        const tx = new TransactionManager(new GitIntegration(deps.runner));
        const matrixManager = new MatrixManager();
        const syncManager = new SyncManager(matrixManager, sopsClient, tx);

        const plan = await syncManager.plan(manifest, repoRoot, { namespace });

        if (plan.totalKeys === 0) {
          if (isJsonMode()) {
            formatter.json({
              namespace: namespace ?? "all",
              totalKeys: 0,
              cells: [],
            });
            return;
          }
          formatter.success(
            namespace
              ? `${namespace} is fully in sync across all environments`
              : "All namespaces are fully in sync",
          );
          return;
        }

        if (opts.dryRun) {
          if (isJsonMode()) {
            formatter.json({
              namespace: namespace ?? "all",
              dryRun: true,
              totalKeys: plan.totalKeys,
              cells: plan.cells.map((c: SyncCellPlan) => ({
                namespace: c.namespace,
                environment: c.environment,
                missingKeys: c.missingKeys,
                isProtected: c.isProtected,
              })),
            });
            return;
          }
          formatter.print(`\n${sym("pending")}  Dry run — ${plan.totalKeys} key(s) to scaffold:\n`);
          for (const cell of plan.cells) {
            const prot = cell.isProtected ? ` ${sym("locked")}` : "";
            formatter.print(
              `   ${cell.namespace}/${cell.environment}${prot}: ${cell.missingKeys.join(", ")}`,
            );
          }
          formatter.print("");
          formatter.hint("Run without --dry-run to apply.");
          return;
        }

        if (plan.hasProtectedEnvs) {
          const protEnvs = plan.cells
            .filter((c: SyncCellPlan) => c.isProtected)
            .map((c: SyncCellPlan) => c.environment);
          const unique = [...new Set(protEnvs)].join(", ");
          const confirmed = await formatter.confirm(
            `This will scaffold keys in protected environment(s): ${unique}. Continue?`,
          );
          if (!confirmed) {
            formatter.info("Aborted.");
            return;
          }
        }

        const result = await syncManager.sync(manifest, repoRoot, { namespace });

        if (isJsonMode()) {
          formatter.json({
            namespace: namespace ?? "all",
            totalKeysScaffolded: result.totalKeysScaffolded,
            modifiedCells: result.modifiedCells,
            scaffoldedKeys: result.scaffoldedKeys,
          });
          return;
        }

        formatter.success(
          `Synced ${result.totalKeysScaffolded} key(s) across ${result.modifiedCells.length} environment(s)`,
        );
        for (const cell of result.modifiedCells) {
          const keys = result.scaffoldedKeys[cell];
          formatter.print(`   ${sym("pending")}  ${cell}: ${keys.join(", ")}`);
        }
        formatter.hint("Replace pending values with: clef set <namespace>/<env> <key>");
      } catch (err) {
        handleCommandError(err);
      }
    });
}
