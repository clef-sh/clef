import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import { parse as parseYaml } from "yaml";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter, isJsonMode } from "../output/formatter";
import { sym } from "../output/symbols";
import { DEFAULT_REGISTRY, fetchIndex, fetchBrokerFile, findBroker } from "../registry/client";

const TIER_LABELS: Record<number, string> = {
  1: "self-expiring",
  2: "stateful",
  3: "complex",
};

export function registerInstallCommand(
  program: Command,
  _deps: { runner: SubprocessRunner },
): void {
  program
    .command("install <broker>")
    .description(
      "Install a broker template from the Clef registry.\n\n" +
        "Downloads broker.yaml, handler.ts, and README.md\n" +
        "into brokers/<name>/ in your project.\n\n" +
        "Exit codes:\n" +
        "  0  Broker installed successfully\n" +
        "  1  Error (broker not found, network failure, etc.)",
    )
    .option("--registry <url>", "Custom registry base URL", DEFAULT_REGISTRY)
    .option("--force", "Overwrite existing broker directory without prompting")
    .action(async (brokerName: string, options: { registry: string; force?: boolean }) => {
      try {
        const repoRoot = (program.opts().dir as string) || process.cwd();
        const registryUrl = options.registry;

        formatter.info(`Fetching ${brokerName} from registry...`);

        // Fetch index
        const index = await fetchIndex(registryUrl);
        const entry = findBroker(index, brokerName);

        if (!entry) {
          formatter.error(
            `Broker "${brokerName}" not found in the registry. Run 'clef search' to list available brokers.`,
          );
          process.exit(1);
          return;
        }

        // Check if directory already exists
        const brokerDir = path.join(repoRoot, "brokers", entry.name);
        if (fs.existsSync(brokerDir) && !options.force) {
          const overwrite = await formatter.confirm(
            `brokers/${entry.name}/ already exists. Overwrite?`,
          );
          if (!overwrite) {
            formatter.info("Installation cancelled.");
            process.exit(0);
            return;
          }
        }

        // Download files
        const files: Array<{ name: string; content: string }> = [];
        for (const filename of ["broker.yaml", "handler.ts", "README.md"]) {
          try {
            const content = await fetchBrokerFile(registryUrl, entry.path, filename);
            files.push({ name: filename, content });
          } catch {
            // handler.ts might be handler.js
            if (filename === "handler.ts") {
              try {
                const content = await fetchBrokerFile(registryUrl, entry.path, "handler.js");
                files.push({ name: "handler.js", content });
              } catch {
                formatter.warn(`Could not download handler file for ${brokerName}`);
              }
            }
          }
        }

        if (files.length === 0) {
          formatter.error(`Could not download any files for ${brokerName}`);
          process.exit(1);
          return;
        }

        // Write files
        if (!fs.existsSync(brokerDir)) {
          fs.mkdirSync(brokerDir, { recursive: true });
        }

        for (const file of files) {
          fs.writeFileSync(path.join(brokerDir, file.name), file.content, "utf-8");
        }

        // Parse manifest for summary
        const manifestFile = files.find((f) => f.name === "broker.yaml");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed YAML is untyped
        const manifest: any = manifestFile ? parseYaml(manifestFile.content) : {};

        if (isJsonMode()) {
          formatter.json({
            broker: entry.name,
            provider: entry.provider,
            tier: entry.tier,
            files: files.map((f) => `brokers/${entry.name}/${f.name}`),
          });
          process.exit(0);
          return;
        }

        // Print summary
        formatter.print("");
        formatter.print(`  ${sym("success")} ${entry.name}`);
        formatter.print("");
        formatter.keyValue("  Name", entry.name);
        formatter.keyValue("  Provider", entry.provider);
        formatter.keyValue("  Tier", `${entry.tier} (${TIER_LABELS[entry.tier] ?? "unknown"})`);
        formatter.keyValue("  Description", entry.description);
        formatter.print("");

        formatter.section("  Created");
        for (const file of files) {
          formatter.print(`    brokers/${entry.name}/${file.name}`);
        }

        if (manifest.inputs && manifest.inputs.length > 0) {
          formatter.section("  Inputs");
          for (const input of manifest.inputs) {
            const suffix =
              input.default !== undefined ? ` (default: ${input.default})` : " (required)";
            formatter.print(`    ${input.name}${suffix}`);
          }
        }

        if (manifest.output?.keys) {
          formatter.section("  Output");
          formatter.keyValue("    Keys", manifest.output.keys.join(", "));
          if (manifest.output.ttl) {
            formatter.keyValue("    TTL", `${manifest.output.ttl}s`);
          }
        }

        if (manifest.runtime?.permissions?.length > 0) {
          formatter.section("  Permissions");
          for (const perm of manifest.runtime.permissions) {
            formatter.print(`    ${perm}`);
          }
        }

        formatter.print("");
        formatter.hint(`https://registry.clef.sh/brokers/${entry.name}`);

        process.exit(0);
      } catch (err) {
        formatter.error((err as Error).message);
        process.exit(1);
      }
    });
}
