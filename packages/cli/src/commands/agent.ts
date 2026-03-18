import { Command } from "commander";
import { SubprocessRunner } from "@clef-sh/core";
import { formatter } from "../output/formatter";
import { sym } from "../output/symbols";

export function registerAgentCommand(program: Command, _deps: { runner: SubprocessRunner }): void {
  const agentCmd = program.command("agent").description("Runtime secrets sidecar agent");

  agentCmd
    .command("start")
    .description(
      "Start the Clef agent sidecar.\n\n" +
        "  Fetches an encrypted artifact from an HTTP URL or local file,\n" +
        "  decrypts in memory, and serves secrets via localhost HTTP.\n\n" +
        "Usage:\n" +
        "  clef agent start --source https://bucket.s3.amazonaws.com/artifact.json\n" +
        "  clef agent start --source ./artifact.json --port 8080",
    )
    .option(
      "--source <url>",
      "HTTP URL or local file path to artifact (overrides CLEF_AGENT_SOURCE)",
    )
    .option("--port <port>", "HTTP API port (overrides CLEF_AGENT_PORT)")
    .option(
      "--poll-interval <seconds>",
      "Seconds between polls (overrides CLEF_AGENT_POLL_INTERVAL)",
    )
    .action(async (opts: { source?: string; port?: string; pollInterval?: string }) => {
      try {
        // Set env vars from CLI flags before resolving config
        if (opts.source) process.env.CLEF_AGENT_SOURCE = opts.source;
        if (opts.port) process.env.CLEF_AGENT_PORT = opts.port;
        if (opts.pollInterval) process.env.CLEF_AGENT_POLL_INTERVAL = opts.pollInterval;

        // Lazy-load @clef-sh/agent so the CLI doesn't fail at startup when the
        // agent module hasn't been resolved yet for commands other than `clef agent`.
        const agentModule = await import("@clef-sh/agent");
        const {
          resolveConfig,
          SecretsCache,
          AgeDecryptor,
          ArtifactPoller,
          startAgentServer,
          Daemon,
        } = agentModule as typeof import("@clef-sh/agent");

        const config = resolveConfig();
        const decryptor = new AgeDecryptor();
        const privateKey = decryptor.resolveKey(config.ageKey, config.ageKeyFile);
        const cache = new SecretsCache();

        const poller = new ArtifactPoller({
          source: config.source,
          privateKey,
          cache,
          pollInterval: config.pollInterval,
          onError: (err) => formatter.error(`Poll error: ${err.message}`),
        });

        await poller.fetchAndDecrypt();

        const server = await startAgentServer({
          port: config.port,
          token: config.token,
          cache,
        });

        formatter.print(`${sym("clef")}  Starting Clef Agent...\n`);
        formatter.print(`   Source: ${config.source}`);
        formatter.print(`   Port:   ${config.port}`);
        formatter.print(`   Poll:   every ${config.pollInterval}s`);
        formatter.print(`   Token:  ${config.token.slice(0, 8)}...\n`);

        const daemon = new Daemon({
          poller,
          server,
          onLog: (msg) => formatter.print(`   ${msg}`),
        });

        await daemon.start();

        formatter.print(`\n   ${sym("locked")}  API: http://127.0.0.1:${config.port}/v1/secrets`);
        formatter.print(`   Press Ctrl+C to stop.\n`);

        // Keep process alive until daemon shuts down via signal handler
        await daemon.waitForShutdown();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Agent failed to start";
        formatter.error(message);
        process.exit(1);
      }
    });
}
