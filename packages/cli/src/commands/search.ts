import { Command } from "commander";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { DEFAULT_REGISTRY, fetchIndex, RegistryBroker } from "../registry/client";

export function registerSearchCommand(program: Command, _deps: { runner: SubprocessRunner }): void {
  program
    .command("search [query]")
    .description(
      "Search the Clef broker registry.\n\n" +
        "Without arguments, lists all available brokers.\n\n" +
        "Exit codes:\n" +
        "  0  Results found or listing complete\n" +
        "  1  Error fetching registry",
    )
    .option("--provider <name>", "Filter by cloud provider (aws, gcp, azure, agnostic)")
    .option("--tier <n>", "Filter by tier (1, 2, 3)")
    .option("--registry <url>", "Custom registry base URL", DEFAULT_REGISTRY)
    .action(
      async (
        query: string | undefined,
        options: { provider?: string; tier?: string; registry: string },
      ) => {
        try {
          const index = await fetchIndex(options.registry);
          let results = index.brokers;

          // Filter by query
          if (query) {
            const q = query.toLowerCase();
            results = results.filter(
              (b) =>
                b.name.toLowerCase().includes(q) ||
                b.description.toLowerCase().includes(q) ||
                b.provider.toLowerCase().includes(q),
            );
          }

          // Filter by provider
          if (options.provider) {
            results = results.filter((b) => b.provider === options.provider);
          }

          // Filter by tier
          if (options.tier) {
            results = results.filter((b) => b.tier === Number(options.tier));
          }

          if (results.length === 0) {
            formatter.info("No brokers found matching your query.");
            process.exit(0);
            return;
          }

          const label =
            query || options.provider || options.tier
              ? `${results.length} broker${results.length === 1 ? "" : "s"} found`
              : `${results.length} broker${results.length === 1 ? "" : "s"} available`;
          formatter.print(`\n  ${label}\n`);

          printBrokerTable(results);

          formatter.print("");
          process.exit(0);
        } catch (err) {
          formatter.error((err as Error).message);
          process.exit(1);
        }
      },
    );
}

function printBrokerTable(brokers: RegistryBroker[]): void {
  const nameWidth = Math.max(...brokers.map((b) => b.name.length));
  const providerWidth = Math.max(...brokers.map((b) => b.provider.length));

  for (const b of brokers) {
    const name = b.name.padEnd(nameWidth);
    const provider = b.provider.padEnd(providerWidth);
    const tier = `Tier ${b.tier}`;
    formatter.print(`  ${name}  ${provider}  ${tier}  ${b.description}`);
  }
}
