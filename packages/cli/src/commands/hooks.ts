import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import { GitIntegration, SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";

export function registerHooksCommand(program: Command, deps: { runner: SubprocessRunner }): void {
  const hooks = program.command("hooks").description("Manage git hooks for Clef");

  hooks
    .command("install")
    .description("Install the Clef pre-commit hook that blocks unencrypted secret commits")
    .action(async () => {
      try {
        const repoRoot = (program.opts().repo as string) || process.cwd();
        const hookPath = path.join(repoRoot, ".git", "hooks", "pre-commit");

        // Check if hook already exists
        if (fs.existsSync(hookPath)) {
          const content = fs.readFileSync(hookPath, "utf-8");
          if (content.includes("clef") || content.includes("SOPS")) {
            const confirmed = await formatter.confirm(
              "A Clef pre-commit hook already exists. Overwrite?",
            );
            if (!confirmed) {
              formatter.info("Aborted.");
              return;
            }
          } else {
            const confirmed = await formatter.confirm(
              "A pre-commit hook already exists (not Clef). Overwrite?",
            );
            if (!confirmed) {
              formatter.info("Aborted. You can manually add Clef checks to your existing hook.");
              return;
            }
          }
        }

        const git = new GitIntegration(deps.runner);
        await git.installPreCommitHook(repoRoot);

        formatter.success("Pre-commit hook installed");
        formatter.print(`   ${sym("pending")}  ${hookPath}`);
        formatter.hint("Hook runs: clef lint --pre-commit && clef scan --staged");
      } catch (err) {
        formatter.error((err as Error).message);
        process.exit(1);
      }
    });
}
