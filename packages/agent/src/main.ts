/* eslint-disable no-console -- standalone daemon entry point, console is the output mechanism */
/**
 * Standalone entry point for the Clef agent SEA binary.
 *
 * Reads configuration from environment variables, assembles the poller,
 * cache, server, and daemon, then starts the daemon lifecycle.
 */
import { resolveConfig, ConfigError } from "./config";
import { AgeDecryptor } from "./decryptor";
import { SecretsCache } from "./cache";
import { ArtifactPoller } from "./poller";
import { startAgentServer } from "./server";
import { Daemon } from "./lifecycle/daemon";

async function main(): Promise<void> {
  const config = resolveConfig();

  const decryptor = new AgeDecryptor();
  const privateKey = decryptor.resolveKey(config.ageKey, config.ageKeyFile);

  const cache = new SecretsCache();
  const poller = new ArtifactPoller({
    source: config.source,
    privateKey,
    cache,
    pollInterval: config.pollInterval,
    onError: (err) => console.error(`[clef-agent] poll error: ${err.message}`),
  });

  await poller.fetchAndDecrypt();

  const server = await startAgentServer({
    port: config.port,
    token: config.token,
    cache,
  });

  const daemon = new Daemon({
    poller,
    server,
    onLog: (msg) => console.log(`[clef-agent] ${msg}`),
  });

  console.log(`[clef-agent] token: ${config.token.slice(0, 8)}...`);
  await daemon.start();
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    console.error(`[clef-agent] config error: ${err.message}`);
  } else {
    console.error(`[clef-agent] fatal: ${err.message}`);
  }
  process.exit(1);
});
