import * as path from "path";
import { Command } from "commander";
import {
  ManifestParser,
  SopsMissingError,
  SopsVersionError,
  SubprocessRunner,
  MatrixManager,
  ServiceIdentityManager,
  PartialRotationError,
  keyPreview,
  isKmsEnvelope,
} from "@clef-sh/core";
import type { KmsConfig } from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";
import { createSopsClient } from "../age-credential";

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
    .action(
      async (name: string, opts: { namespaces: string; description: string; kmsEnv: string[] }) => {
        try {
          const repoRoot = (program.opts().dir as string) || process.cwd();
          const parser = new ManifestParser();
          const manifest = parser.parse(path.join(repoRoot, "clef.yaml"));

          const namespaces = opts.namespaces.split(",").map((s) => s.trim());

          // Parse --kms-env mappings
          let kmsEnvConfigs: Record<string, KmsConfig> | undefined;
          if (opts.kmsEnv.length > 0) {
            kmsEnvConfigs = {};
            for (const mapping of opts.kmsEnv) {
              const eqIdx = mapping.indexOf("=");
              if (eqIdx === -1) {
                throw new Error(
                  `Invalid --kms-env format: '${mapping}'. Expected: env=provider:keyId`,
                );
              }
              const envName = mapping.slice(0, eqIdx);
              const rest = mapping.slice(eqIdx + 1);
              const colonIdx = rest.indexOf(":");
              if (colonIdx === -1) {
                throw new Error(
                  `Invalid --kms-env format: '${mapping}'. Expected: env=provider:keyId`,
                );
              }
              const provider = rest.slice(0, colonIdx);
              const keyId = rest.slice(colonIdx + 1);
              if (!["aws", "gcp", "azure"].includes(provider)) {
                throw new Error(
                  `Invalid KMS provider '${provider}'. Must be one of: aws, gcp, azure.`,
                );
              }
              kmsEnvConfigs[envName] = {
                provider: provider as "aws" | "gcp" | "azure",
                keyId,
              };
            }
          }

          const hasAgeEnvs =
            !kmsEnvConfigs || manifest.environments.some((e) => !kmsEnvConfigs![e.name]);

          const protectedEnvs = manifest.environments.filter((e) => e.protected).map((e) => e.name);

          if (protectedEnvs.length > 0 && hasAgeEnvs) {
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
          const sopsClient = await createSopsClient(repoRoot, deps.runner);
          const manager = new ServiceIdentityManager(sopsClient, matrixManager);

          formatter.print(`${sym("working")}  Creating service identity '${name}'...`);

          const result = await manager.create(
            name,
            namespaces,
            opts.description || name,
            manifest,
            repoRoot,
            kmsEnvConfigs,
          );

          formatter.success(`Service identity '${name}' created.`);
          formatter.print(`\n  Namespaces: ${result.identity.namespaces.join(", ")}`);
          formatter.print(
            `  Environments: ${Object.keys(result.identity.environments).join(", ")}\n`,
          );

          if (Object.keys(result.privateKeys).length > 0) {
            // Print private keys ONCE (age-only environments)
            formatter.warn(
              "Private keys are shown ONCE. Store them securely (e.g. AWS Secrets Manager, Vault).\n",
            );

            for (const [envName, privateKey] of Object.entries(result.privateKeys)) {
              formatter.print(`  ${envName}:`);
              formatter.print(`    ${privateKey}\n`);
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

          formatter.hint(
            `git add clef.yaml && git commit -m "feat: add service identity '${name}'"`,
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
        const sopsClient = await createSopsClient(repoRoot, deps.runner);
        const manager = new ServiceIdentityManager(sopsClient, matrixManager);

        const identities = manager.list(manifest);

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
          return [si.name, si.namespaces.join(", "), envStr];
        });

        formatter.table(rows, ["Name", "Namespaces", "Environments"]);
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
        const sopsClient = await createSopsClient(repoRoot, deps.runner);
        const manager = new ServiceIdentityManager(sopsClient, matrixManager);

        const identity = manager.get(manifest, name);
        if (!identity) {
          formatter.error(`Service identity '${name}' not found.`);
          process.exit(1);
          return;
        }

        formatter.print(`\nService Identity: ${identity.name}`);
        formatter.print(`Description: ${identity.description}`);
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
        const sopsClient = await createSopsClient(repoRoot, deps.runner);
        const manager = new ServiceIdentityManager(sopsClient, matrixManager);

        const issues = await manager.validate(manifest, repoRoot);

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
        const sopsClient = await createSopsClient(repoRoot, deps.runner);
        const manager = new ServiceIdentityManager(sopsClient, matrixManager);

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

        formatter.success(`Key rotated for '${name}'.`);

        formatter.warn("New private keys are shown ONCE. Store them securely.\n");

        for (const [envName, privateKey] of Object.entries(newKeys)) {
          formatter.print(`  ${envName}:`);
          formatter.print(`    ${privateKey}\n`);
        }
        for (const k of Object.keys(newKeys)) newKeys[k] = "";

        formatter.hint(
          `git add clef.yaml && git commit -m "chore: rotate service identity '${name}'"`,
        );
      } catch (err) {
        if (err instanceof SopsMissingError || err instanceof SopsVersionError) {
          formatter.formatDependencyError(err);
          process.exit(1);
          return;
        }
        if (err instanceof PartialRotationError) {
          formatter.error(err.message);
          formatter.warn("Partial rotation succeeded. New private keys below — store them NOW.\n");
          for (const [envName, privateKey] of Object.entries(err.rotatedKeys)) {
            formatter.print(`  ${envName}:`);
            formatter.print(`    ${privateKey}\n`);
          }
          for (const k of Object.keys(err.rotatedKeys)) {
            (err.rotatedKeys as Record<string, string>)[k] = "";
          }
          process.exit(1);
          return;
        }
        formatter.error((err as Error).message);
        process.exit(1);
      }
    });
}
